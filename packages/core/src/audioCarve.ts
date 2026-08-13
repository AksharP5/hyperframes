/**
 * Voiceover carve: find the bands a voice occupies and dip a music bed there,
 * so the voice sits in front without ducking the whole track.
 *
 * This is a relationship between two tracks, not an effect on one. The controls
 * live on the bed being processed and name the voice to listen to, the same way
 * a sidechain compressor works: you select the track that gets quieter and pick
 * what makes it quieter.
 *
 * The output is an ordinary FX chain of peaking filters, so a carve is just a
 * chain the studio generated rather than a separate rendering path.
 */

import {
  defaultAudioFxParams,
  HF_AUDIO_FX_CHAIN_VERSION,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "./audioFx.js";

export const HF_AUDIO_CARVE_ATTR = "data-fx-carve";

/** Third-octave centres spanning the range speech actually occupies. */
const CANDIDATE_CENTERS_HZ = [160, 250, 400, 630, 1000, 1600, 2500, 4000, 6000] as const;

const FRAME = 4096;
const HOP = 2048;

export interface HfCarveBand {
  freq: number;
  gainDb: number;
  q: number;
}

/**
 * What the author sets: which voice to listen to, how hard to work, and whether
 * the work follows the voice moment to moment.
 *
 * One number for the strength of the effect, not six for its mechanism. The
 * mechanism has six numbers — how deep to cut, how many bands, how wide, how far
 * to favour intelligibility over raw energy, how far the level may drop, how far
 * under the voice to aim — and every one of them was a control nobody could set
 * without knowing what the analysis does with it. They move together anyway: a
 * gentle carve is a shallow cut in few bands with little ducking, a hard one is
 * deeper in more bands with more. `carveProfile` is that relationship, written
 * once.
 */
export interface HfCarveSettings {
  /** Element id of the voice track to analyse. */
  source: string;
  /** How hard to carve, 0..1. */
  strength: number;
  /**
   * Follow the voice rather than sitting at a fixed depth.
   *
   * A static carve holds its cuts for the whole clip, including every pause — the
   * bed is thinned where there is nothing to make room for. Dynamic turns every
   * value into an envelope of the voice's own level, so silence leaves the bed
   * alone and a loud passage pushes the carve to full depth.
   */
  dynamic: boolean;
}

/** The numbers the analysis actually works in, all derived from `strength`. */
export interface HfCarveProfile {
  /** Deepest cut applied to the strongest band. */
  maxCutDb: number;
  /** How many bands to dip. */
  bands: number;
  q: number;
  /**
   * Weight band selection toward intelligibility rather than raw voice energy.
   *
   * Ranking purely by voice power lands on the fundamental almost every time,
   * because that is where a voice is loudest — but masking that actually hurts a
   * voiceover happens higher up, and dipping 160 Hz mostly just thins the bed.
   */
  intelligibilityBias: number;
  /** How far the bed's whole level may come down to make room, in dB. */
  duckDb: number;
  /** How far under the voice the bed should sit while the voice speaks, in dB. */
  headroomDb: number;
}

export const DEFAULT_CARVE: HfCarveSettings = {
  source: "",
  // A quarter, because the knob's range was doubled and this is the point on the
  // new scale that produces what the panel has always defaulted to. Switching
  // carve on sounds the same as it did; the extra range is above, not under.
  strength: 0.25,
  dynamic: false,
};

/**
 * Strength as the six numbers the analysis needs.
 *
 * Each is a straight line from "barely there" to as far as the effect goes. The
 * slopes are twice what they first were: the top of the knob was not strong
 * enough to sit a bed under a loud voice, so what used to be full strength is now
 * the halfway point and everything above it is new range. Quarter strength is
 * therefore where the separate controls' own defaults land, which is what the
 * panel defaults to.
 */
export function carveProfile(strength: number): HfCarveProfile {
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.5;
  return {
    // 2 dB is audible-but-subtle. Past about 10 the hole starts being heard as
    // the effect rather than as room for the voice — which is a price worth
    // paying at the top of the knob, and why the range now runs past it.
    maxCutDb: Number((2 + s * 16).toFixed(2)),
    // One band carves the single worst collision; six is every candidate band
    // speech meaningfully occupies.
    bands: Math.max(1, Math.min(6, Math.round(1 + s * 6))),
    // Wider at low strength so a gentle carve is a tilt rather than a notch.
    q: Number((1.1 + s * 1.2).toFixed(2)),
    // Always weighted toward where masking hurts; at the top, entirely.
    intelligibilityBias: Number(Math.min(1, 0.6 + s * 0.4).toFixed(2)),
    // No level ducking at all at zero: the carve is then purely spectral.
    duckDb: Number((s * 24).toFixed(2)),
    // How far under the voice to aim. Deeper targets at higher strength.
    headroomDb: Number((6 + s * 12).toFixed(2)),
  };
}

/**
 * Read carve settings from an attribute.
 *
 * Projects written before the collapse to one knob carry the six mechanism
 * numbers instead; their depth is the one that says most about intent, so it maps
 * back onto strength rather than being dropped. Everything else about such a
 * carve is re-derived, which is the point of having one control.
 */
export function normalizeCarveSettings(
  raw: Partial<HfCarveSettings & HfCarveProfile> | undefined,
): HfCarveSettings {
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strength = num(raw?.strength);
  const legacyDepth = num(raw?.maxCutDb);
  const resolved =
    strength !== null
      ? strength
      : legacyDepth !== null
        ? // The inverse of the depth line in `carveProfile`, so the 6 dB default
          // reads back as the strength that produces 6 dB.
          (legacyDepth - 2) / 16
        : DEFAULT_CARVE.strength;
  return {
    source: typeof raw?.source === "string" ? raw.source : "",
    strength: Math.min(1, Math.max(0, resolved)),
    dynamic: raw?.dynamic === true,
  };
}

/** Averaged power spectrum, Welch-style. */
function powerSpectrum(
  mono: Float32Array,
  sampleRate: number,
): { freqs: number[]; power: number[] } {
  const n = Math.max(mono.length, FRAME);
  const padded =
    mono.length >= FRAME
      ? mono
      : (() => {
          const p = new Float32Array(FRAME);
          p.set(mono);
          return p;
        })();

  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const bins = FRAME / 2 + 1;
  const acc = new Float64Array(bins);
  let frames = 0;
  for (let start = 0; start + FRAME <= n; start += HOP) {
    // Goertzel-free naive DFT would be O(n^2); use a real FFT via recursion on
    // a copied frame. FRAME is a power of two so the radix-2 split is exact.
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = (padded[start + i] ?? 0) * window[i]!;
    fft(re, im);
    for (let k = 0; k < bins; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  if (frames === 0) frames = 1;

  const freqs: number[] = [];
  const power: number[] = [];
  for (let k = 0; k < bins; k++) {
    freqs.push((k * sampleRate) / FRAME);
    power.push(acc[k]! / frames);
  }
  return { freqs, power };
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function bandPower(freqs: number[], power: number[], center: number): number {
  const lo = center / Math.pow(2, 1 / 6);
  const hi = center * Math.pow(2, 1 / 6);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i]! >= lo && freqs[i]! < hi) {
      sum += power[i]!;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * How far the bias may move a band in the ranking, in dB, at full strength.
 *
 * This has to be on the scale of the thing it competes with. Speech spreads
 * 20-30 dB across these candidate bands — it falls off roughly 6 dB per octave
 * above the fundamental — so a bias that can only shift the ranking by a few dB
 * cannot shift it at all. 30 dB gives the 0.7 default about 21 dB of authority
 * over the low bands, enough to cross a normal voice's tilt, while still leaving
 * a band the voice genuinely dominates able to win: the bias reweights the
 * ranking, it does not override the spectrum.
 */
const BIAS_AUTHORITY_DB = 30;

/**
 * Ranking penalty for a candidate band, in dB. Zero at 2 kHz, where speech
 * intelligibility lives and where a bed most often masks a voice, rising as a
 * band sits further away in either direction.
 *
 * Applied in dB, and that is the point. As a multiplicative weight of
 * `1 - bias + bias * shaped` it is bounded below by `1 - bias`, so the most it
 * could ever move a ranking is `10*log10(1/(1 - bias))`: 5.2 dB at the 0.7
 * default, 3 dB at 0.5. Against speech's own 20-30 dB tilt that is no influence,
 * and every bias below ~0.95 ranks exactly like bias 0 — selecting the
 * fundamental every time, the precise outcome the bias exists to prevent. A
 * fixture whose bands sit 2 dB apart cannot tell the two apart.
 */
function intelligibilityPenaltyDb(center: number, bias: number): number {
  const octavesFrom2k = Math.log2(center / 2000);
  const shaped = Math.exp(-(octavesFrom2k * octavesFrom2k) / 2);
  return bias * BIAS_AUTHORITY_DB * (1 - shaped);
}

/**
 * Analyse a voice and return the bands to dip in the bed. Bands come back in
 * ascending frequency; the deepest cut lands on the strongest band and the
 * others scale with their relative weight, floored at half depth so a selected
 * band still does something audible.
 */
export function analyseCarveBands(
  voice: Float32Array,
  sampleRate: number,
  profile: HfCarveProfile,
): HfCarveBand[] {
  if (voice.length === 0) return [];
  const { freqs, power } = powerSpectrum(voice, sampleRate);

  const scored = CANDIDATE_CENTERS_HZ.map((center) => {
    const bandPowerAt = bandPower(freqs, power, center);
    return {
      center,
      hasEnergy: bandPowerAt > 0,
      // A band with no energy scores -Infinity rather than a large negative
      // number, so it can never outrank a real band however favourably the bias
      // views its frequency.
      scoreDb:
        bandPowerAt > 0
          ? 10 * Math.log10(bandPowerAt) -
            intelligibilityPenaltyDb(center, profile.intelligibilityBias)
          : Number.NEGATIVE_INFINITY,
    };
  }).sort((a, b) => b.scoreDb - a.scoreDb);

  const selected = scored.slice(0, Math.max(1, profile.bands)).filter((b) => b.hasEnergy);
  if (selected.length === 0) return [];

  const topDb = selected[0]!.scoreDb;
  return selected
    .map(({ center, scoreDb }) => {
      // Same relative depth as a ratio of linear scores would give — a band 3 dB
      // under the strongest gets half its cut — read off the dB difference.
      const relative = Math.pow(10, (scoreDb - topDb) / 10);
      const depth = Math.min(
        profile.maxCutDb,
        Math.max(profile.maxCutDb / 2, profile.maxCutDb * relative),
      );
      return { freq: center, gainDb: -Number(depth.toFixed(2)), q: profile.q };
    })
    .sort((a, b) => a.freq - b.freq);
}

/**
 * How far below a band's own loudest moment counts as nothing to carve. A voice
 * 30 dB down on its peak is a room tone or a breath, not speech, and the bed
 * should be flat there.
 */
const DYNAMIC_RANGE_DB = 30;

/**
 * Envelope follower time constants, in seconds. Asymmetric on purpose, the way
 * a ducker is: the cut has to be there by the time a word is audible, and has to
 * leave slowly enough that the bed does not pump between syllables.
 */
const ATTACK_S = 0.05;
const RELEASE_S = 0.25;

/**
 * Release for the level envelope, which is far slower than the filters' own.
 *
 * A notch closing quickly is inaudible — nothing about the bed's loudness
 * changes. The whole bed coming back is not: at a filter's 0.25s the music
 * jumped to full the instant a word ended, and what you hear then is the effect
 * switching off rather than a mix breathing. Slower than any gap inside a
 * sentence, so it rides through the pauses between words and only recovers
 * between sentences.
 *
 * It also has to be well clear of the envelope's own step. A long voice is
 * measured about every 0.3s, so a release anywhere near that puts the entire
 * recovery inside one step — a jump, whatever the constant claims.
 */
const DUCK_RELEASE_S = 1.6;

/**
 * Windows an envelope may spend. Held under `MAX_AUTOMATION_POINTS` with room
 * for the two end points, because `normalizeAutomation` truncates an over-budget
 * lane rather than thinning it — losing the tail would leave the last cut held
 * for the rest of the bed, which is the one failure this feature must not have.
 */
const POINT_BUDGET = 400;

/** Below this a cut is inaudible, so it is recorded as no cut at all. */
const SNAP_DB = 0.2;

/**
 * Smallest move worth its own breakpoint. Coarse enough that a lane stays
 * editable by hand — a syllable-rate envelope at the analysis hop draws a point
 * every 85 ms, which is a wall of handles nobody can grab — and fine enough that
 * the shape is unchanged, since the segments either side interpolate.
 */
const STEP_DB = 0.5;

/**
 * Thin a raw per-frame envelope down to the points where its value actually
 * moved by `stepDb`, anchoring the run each drop ends.
 *
 * Segments interpolate, so dropping a run of equal values does not hold them —
 * it draws a straight line from wherever the last kept point was, which turned
 * a silent stretch before the run into a slow slide into it. Keeping the last
 * value of the run pins the plateau flat and puts the whole move where it
 * belongs. Shared by the two envelope builders below, which differ only in how
 * `raw` gets built.
 */
function simplifyStepPoints(
  raw: readonly { t: number; v: number }[],
  stepDb: number,
): { t: number; v: number }[] {
  const points: { t: number; v: number }[] = [{ t: 0, v: 0 }];
  let lastKept = 0;
  let keptIndex = -1;
  raw.forEach((pt, i) => {
    if (i !== raw.length - 1 && Math.abs(pt.v - lastKept) < stepDb) return;
    if (i > 0 && keptIndex !== i - 1) points.push(raw[i - 1]!);
    points.push(pt);
    lastKept = pt.v;
    keptIndex = i;
  });
  return points;
}

export interface HfCarveDynamics {
  /** The band this envelope drives, matching a band from `analyseCarveBands`. */
  freq: number;
  /** Gain in dB over time, in seconds from the start of the *voice* clip. */
  points: { t: number; v: number }[];
}

/**
 * Turn each carved band into an envelope that follows the voice's level in that
 * same band.
 *
 * The depth from `analyseCarveBands` becomes the envelope's ceiling rather than a
 * constant: full depth where that band is at its loudest in the voice, flat where
 * the voice is silent, scaled in dB between the two. Written as automation on the
 * filters' gain, so playback and render both already know how to follow it.
 *
 * Times are relative to the voice clip, since that is what was measured. A caller
 * placing these on another element shifts them by the gap between the two clips'
 * starts. This assumes the voice plays from its own beginning at its `data-start`
 * — a clip with a media offset would need that added.
 */
export function analyseCarveDynamics(
  voice: Float32Array,
  sampleRate: number,
  bands: HfCarveBand[],
): HfCarveDynamics[] {
  if (voice.length === 0 || bands.length === 0) return [];

  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  // One window per emitted point, so the hop is what keeps the lane in budget.
  const hop = Math.max(FRAME, Math.ceil(voice.length / POINT_BUDGET));
  const bins = FRAME / 2 + 1;
  const freqs: number[] = [];
  for (let k = 0; k < bins; k++) freqs.push((k * sampleRate) / FRAME);

  const times: number[] = [];
  const perBand = bands.map(() => [] as number[]);
  for (let start = 0; start < voice.length; start += hop) {
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = (voice[start + i] ?? 0) * window[i]!;
    fft(re, im);
    const power: number[] = [];
    for (let k = 0; k < bins; k++) power.push(re[k]! * re[k]! + im[k]! * im[k]!);
    times.push((start + FRAME / 2) / sampleRate);
    bands.forEach((band, b) => perBand[b]!.push(bandPower(freqs, power, band.freq)));
  }

  const duration = voice.length / sampleRate;
  const attack = 1 - Math.exp(-(hop / sampleRate) / ATTACK_S);
  const release = 1 - Math.exp(-(hop / sampleRate) / RELEASE_S);

  return bands.map((band, b) => {
    const powers = perBand[b]!;
    const peak = Math.max(...powers);
    let level = 0;
    const raw: { t: number; v: number }[] = [];
    powers.forEach((p, i) => {
      // Relative to this band's own loudest moment, so a quiet band still gets a
      // full envelope rather than a permanently shallow one.
      const target =
        p > 0 && peak > 0 ? Math.max(0, 1 + (10 * Math.log10(p / peak)) / DYNAMIC_RANGE_DB) : 0;
      level += (target > level ? attack : release) * (target - level);
      const scaled = band.gainDb * level;
      const v = Math.abs(scaled) < SNAP_DB ? 0 : Number(scaled.toFixed(1));
      raw.push({ t: Number(times[i]!.toFixed(3)), v });
    });
    const points = simplifyStepPoints(raw, STEP_DB);
    // The last point's value is held for the rest of the bed, so it has to be
    // no cut and it has to be at the end of the voice.
    points.push({ t: Number(Math.max(duration, points.at(-1)!.t).toFixed(3)), v: 0 });
    return { freq: band.freq, points };
  });
}

/** Level in dB of one window, or -Infinity for silence. */
function windowDb(samples: Float32Array, from: number, count: number): number {
  let sum = 0;
  let n = 0;
  for (let i = from; i < from + count; i++) {
    const s = samples[i];
    if (s === undefined) break;
    sum += s * s;
    n += 1;
  }
  if (n === 0) return Number.NEGATIVE_INFINITY;
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

/**
 * The level envelope that keeps a bed under a voice.
 *
 * The spectral carve makes room in the frequency domain, which does nothing
 * about a bed that is simply louder than the voice: the notches sit in the right
 * places while the level goes on winning. This measures both tracks over the
 * same windows and returns the gain the bed needs to sit `headroomDb` under the
 * voice — no more than `duckDb`, and nothing at all where the voice is not
 * speaking, so pauses stay open rather than being held down.
 *
 * Times are in seconds from the start of the *voice* clip; `offsetSeconds` is
 * how far into the bed the voice's start falls, so the two are read at the same
 * moment of the composition even when the clips begin at different times.
 */
export function analyseCarveDuck(
  voice: Float32Array,
  bed: Float32Array,
  sampleRate: number,
  profile: HfCarveProfile,
  offsetSeconds: number,
): { t: number; v: number }[] {
  if (voice.length === 0 || profile.duckDb <= 0) return [];

  const hop = Math.max(FRAME, Math.ceil(voice.length / POINT_BUDGET));
  const bedOffset = Math.round(offsetSeconds * sampleRate);

  const voiceDbs: number[] = [];
  const bedDbs: number[] = [];
  const times: number[] = [];
  for (let start = 0; start < voice.length; start += hop) {
    voiceDbs.push(windowDb(voice, start, FRAME));
    bedDbs.push(windowDb(bed, start + bedOffset, FRAME));
    times.push((start + FRAME / 2) / sampleRate);
  }

  // Speaking, rather than merely non-zero: a room tone 30 dB under the voice's
  // own peak is not something to duck for, and gating on it is what keeps the
  // bed up through pauses.
  const voicePeak = Math.max(...voiceDbs);
  const speakingFloor = voicePeak - DYNAMIC_RANGE_DB;

  const attack = 1 - Math.exp(-(hop / sampleRate) / ATTACK_S);
  const release = 1 - Math.exp(-(hop / sampleRate) / DUCK_RELEASE_S);

  let level = 0;
  const raw: { t: number; v: number }[] = [];
  voiceDbs.forEach((vDb, i) => {
    const bDb = bedDbs[i] ?? Number.NEGATIVE_INFINITY;
    // How far over the line the bed is, right now.
    const over = vDb > speakingFloor && Number.isFinite(bDb) ? bDb - (vDb - profile.headroomDb) : 0;
    const target = Math.min(profile.duckDb, Math.max(0, over));
    level += (target > level ? attack : release) * (target - level);
    const v = level < SNAP_DB ? 0 : -Number(level.toFixed(1));
    raw.push({ t: Number(times[i]!.toFixed(3)), v });
  });

  // Let the release finish past the last word. A lane's final point has to be no
  // cut — otherwise the bed stays dipped for the rest of the clip — but jumping
  // there from a full duck is the same flip the slow release exists to prevent,
  // moved to the end of the narration. So the decay carries on at its own rate
  // beyond the voice until it is inaudible, and only then pins.
  const hopSeconds = hop / sampleRate;
  let tailTime = times.at(-1) ?? 0;
  while (level >= SNAP_DB) {
    level += release * -level;
    tailTime += hopSeconds;
    raw.push({
      t: Number(tailTime.toFixed(3)),
      v: level < SNAP_DB ? 0 : -Number(level.toFixed(1)),
    });
  }

  const points = simplifyStepPoints(raw, STEP_DB);
  // Pin the end at no cut, unless the release already got there — a second point
  // at the same time and value is just noise in the lane.
  const duration = voice.length / sampleRate;
  const last = points.at(-1)!;
  const endTime = Number(Math.max(duration, last.t).toFixed(3));
  if (!(last.v === 0 && last.t >= endTime)) points.push({ t: endTime, v: 0 });
  return points;
}

/** Carve bands as an ordinary FX chain of peaking filters. */
export function carveBandsToChain(bands: HfCarveBand[]): HfAudioFxChain {
  const nodes: HfAudioFxNode[] = bands.map((b) => ({
    type: "peaking",
    enabled: true,
    params: {
      ...defaultAudioFxParams("peaking"),
      frequency: b.freq,
      gain: b.gainDb,
      q: b.q,
    },
  }));
  return { version: HF_AUDIO_FX_CHAIN_VERSION, nodes };
}
