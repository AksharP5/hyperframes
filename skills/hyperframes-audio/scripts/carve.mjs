#!/usr/bin/env node
/**
 * Apply a voiceover carve to a composition, from the command line.
 *
 * The carve is an analysis: it listens to a voice track, finds the bands it
 * occupies, and writes a chain of dips into the music bed plus a level match. In
 * Studio a panel runs it. This is the same analysis for an agent that has no
 * panel to click — identical functions from `@hyperframes/core`, identical
 * output, so a composition carved here and one carved in Studio are the same
 * three attributes.
 *
 *   node carve.mjs --comp index.html
 *   node carve.mjs --comp index.html --bed music-bed --voice narration \
 *        --strength 0.45
 *
 * With no --bed/--voice it works out the pair itself, and refuses rather than
 * guessing when it cannot tell them apart. Dynamic by default, because a bed
 * thinned through every pause is worse than one that follows the voice.
 *
 * Needs `ffmpeg` on PATH (to decode the audio) and `@hyperframes/core` resolvable
 * from the composition's project (`npm i -D @hyperframes/core`) — the CLI bundles
 * core inline rather than shipping it as a package, so it cannot be borrowed from
 * there.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Sample rate the analysis runs at. Matches Studio's own decode rate, so the
 *  bands and envelopes come out the same either way. */
const SAMPLE_RATE = 48000;

const usage = `carve.mjs --comp <file.html> [--bed <elementId>] [--voice <elementId>]
              [--strength 0..1] [--static] [--dry-run] [--core <dir>]

  --bed       id of the music track that gets carved   (detected if omitted)
  --voice     id of the voice track to listen to       (detected if omitted)
  --strength  how hard to carve, 0..1 (default 0.25)
  --static    hold one depth instead of following the voice (default: follow)
  --dry-run   report what it would write, touch nothing
  --core      directory to resolve @hyperframes/core from (default: the comp's)`;

function parseArgs(argv) {
  // Dynamic unless told otherwise: a static carve thins the bed through every
  // pause, which is the wrong default for anything with gaps in the narration.
  const args = { strength: 0.25, dynamic: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === "--comp") args.comp = next();
    else if (flag === "--bed") args.bed = next();
    else if (flag === "--voice") args.voice = next();
    else if (flag === "--strength") args.strength = Number(next());
    else if (flag === "--core") args.core = next();
    else if (flag === "--dynamic") args.dynamic = true;
    else if (flag === "--static") args.dynamic = false;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "-h" || flag === "--help") fail(usage, 0);
    else fail(`unknown flag: ${flag}\n\n${usage}`);
  }
  if (!args.comp) fail(`--comp is required\n\n${usage}`);
  if (!Number.isFinite(args.strength) || args.strength < 0 || args.strength > 1) {
    fail("--strength must be a number from 0 to 1");
  }
  return args;
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Load the carve analysis out of `@hyperframes/core`.
 *
 * Resolved from the project rather than from this script, which lives wherever
 * the skill was installed — a sibling of the composition is what has the
 * dependency.
 */
async function loadCore(fromDir) {
  const require = createRequire(pathToFileURL(resolve(fromDir, "package.json")));
  const load = (subpath) => {
    const file = require.resolve(`@hyperframes/core/${subpath}`);
    return import(pathToFileURL(file).href);
  };
  try {
    return {
      carve: await load("audio-carve"),
      fx: await load("audio-fx"),
    };
  } catch (error) {
    fail(
      `cannot resolve @hyperframes/core from ${fromDir}\n` +
        `  install or update it:  npm i -D @hyperframes/core\n` +
        `  (the audio-carve export needs a version that ships the carve analysis)\n` +
        `  or point at one:   --core <dir containing node_modules/@hyperframes/core>\n` +
        `  (${error.message})`,
    );
  }
}

/** Mono float PCM for one media file, via ffmpeg. */
function decode(path) {
  let raw;
  try {
    raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 1 << 30 },
    );
  } catch (error) {
    fail(`could not decode ${path}\n  ${error.message.split("\n")[0]}`);
  }
  if (raw.length === 0) fail(`no audio in ${path}`);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;

const unescapeAttr = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Every media element with a src, as {id, tag, kind}. */
function mediaElements(html) {
  const found = [];
  for (const match of html.matchAll(/<(audio|video)\b[^>]*>/gi)) {
    const tag = match[0];
    // `\sid=` and not `id=`: `data-hf-id` would match first.
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    if (id && attrOf(tag, "src")) found.push({ id, tag, kind: match[1].toLowerCase() });
  }
  return found;
}

const MUSIC_NAME = /music|bgm|\bbed\b|soundtrack|score|song|theme/i;
const VOICE_NAME = /voice|\bvo\b|narrat|speech|dialog|vocal|\btts\b|announce/i;
const NOT_A_BED = /sfx|foley|whoosh|impact|riser|stinger|swoosh|click|ding|boom/i;

/**
 * Fraction of the track that is more than 25 dB below its own peak.
 *
 * The one cheap thing that tells speech from music without recognising either:
 * a voice stops between phrases and a music bed does not. Measured in 50 ms
 * frames, which is short enough to see the gap between words and long enough not
 * to see the gap between two cycles of a low note.
 */
function silenceFraction(samples) {
  const frame = Math.floor(SAMPLE_RATE * 0.05);
  const levels = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let k = i; k < i + frame; k += 1) sum += samples[k] * samples[k];
    levels.push(Math.sqrt(sum / frame));
  }
  if (levels.length === 0) return 0;
  const floor = Math.max(...levels) * 10 ** (-25 / 20);
  return levels.filter((level) => level < floor).length / levels.length;
}

/**
 * Work out which track is the bed and which is the voice.
 *
 * Names first, because they are what the author already told us and the answer is
 * explainable. Only when a name does not decide does it listen to the audio, and
 * it refuses rather than picking when the measurement is close — carving the wrong
 * track is a silent, confusing failure, and asking is cheap.
 */
function detectPair(html, compDir, given) {
  const all = mediaElements(html);
  const pick = (id, what) => {
    const found = all.find((el) => el.id === id);
    if (!found) fail(`no <audio>/<video> with id="${id}" in the composition`);
    return { ...found, why: `--${what}` };
  };
  let bed = given.bed ? pick(given.bed, "bed") : null;
  let voice = given.voice ? pick(given.voice, "voice") : null;
  if (bed && voice) return { bed, voice };

  // A voiceover and a bed are both normally <audio>; a <video> is only considered
  // when there is no audio element left to be the voice, which is what a talking
  // head recut looks like.
  const free = all.filter((el) => el.id !== bed?.id && el.id !== voice?.id);
  const candidates = free.filter((el) => !NOT_A_BED.test(`${el.id} ${attrOf(el.tag, "src")}`));
  const named = (re) => candidates.filter((el) => re.test(`${el.id} ${attrOf(el.tag, "src")}`));

  if (!bed) {
    const byName = named(MUSIC_NAME).filter((el) => el.id !== voice?.id);
    if (byName.length === 1) bed = { ...byName[0], why: "name looks like music" };
    else if (byName.length > 1) {
      fail(
        `several tracks look like music (${byName.map((el) => el.id).join(", ")}) — name one with --bed`,
      );
    }
  }
  if (!voice) {
    const byName = named(VOICE_NAME).filter((el) => el.id !== bed?.id);
    if (byName.length === 1) voice = { ...byName[0], why: "name looks like a voice" };
    else if (byName.length > 1) {
      fail(
        `several tracks look like a voice (${byName.map((el) => el.id).join(", ")}) — name one with --voice`,
      );
    }
  }

  const left = candidates.filter((el) => el.id !== bed?.id && el.id !== voice?.id);
  const audioLeft = left.filter((el) => el.kind === "audio");
  const pool = audioLeft.length > 0 ? audioLeft : left;

  // One track left and one role open: no measurement can be more certain than
  // that, and decoding to confirm it would only cost time.
  if (!voice && bed && pool.length === 1) voice = { ...pool[0], why: "only track left" };
  if (!bed && voice && pool.length === 1) bed = { ...pool[0], why: "only track left" };

  if (!voice || !bed) {
    if (pool.length < 2) {
      fail(
        `cannot find a voice and a music track to carve\n` +
          `  media in the composition: ${all.map((el) => el.id).join(", ") || "none"}\n` +
          `  name them with --bed and --voice`,
      );
    }
    // Listen: the one that stops between phrases is the voice.
    const scored = pool
      .map((el) => ({
        el,
        pauses: silenceFraction(decode(resolve(compDir, unescapeAttr(attrOf(el.tag, "src"))))),
      }))
      .sort((a, b) => b.pauses - a.pauses);
    const [first, second] = scored;
    if (first.pauses - second.pauses < 0.08) {
      fail(
        `cannot tell the voice from the music by ear either — ` +
          `${scored.map((s) => `${s.el.id} ${(s.pauses * 100).toFixed(0)}% quiet`).join(", ")}\n` +
          `  name them with --bed and --voice`,
      );
    }
    const why = (s) => `${(s.pauses * 100).toFixed(0)}% of it is quiet`;
    if (!voice) voice = { ...first.el, why: why(first) };
    if (!bed) bed = { ...second.el, why: why(second) };
  }
  if (bed.id === voice.id) fail(`--bed and --voice are the same track ("${bed.id}")`);
  return { bed, voice };
}

const startOf = (tag) => {
  const raw = Number(attrOf(tag, "data-start"));
  return Number.isFinite(raw) ? raw : 0;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const compPath = resolve(args.comp);
  const compDir = dirname(compPath);
  const { carve: carveApi, fx: fxApi } = await loadCore(args.core ? resolve(args.core) : compDir);

  const html = readFileSync(compPath, "utf-8");
  const { bed: bedEl, voice: voiceEl } = detectPair(html, compDir, args);
  const bedTag = bedEl.tag;
  const voiceTag = voiceEl.tag;
  const bedSrc = attrOf(bedTag, "src");
  const voiceSrc = attrOf(voiceTag, "src");
  process.stdout.write(
    `bed    ${bedEl.id} (${bedEl.why})\nvoice  ${voiceEl.id} (${voiceEl.why})\n`,
  );

  const profile = carveApi.carveProfile(args.strength);
  const voice = decode(resolve(compDir, unescapeAttr(voiceSrc)));
  const bands = carveApi.analyseCarveBands(voice, SAMPLE_RATE, profile);

  // The level half of the carve needs both tracks: "how far over the voice is
  // this bed" cannot be answered by listening to one of them. Times come back on
  // the voice's clock, so the gap between the two clips' starts aligns them.
  const offset = startOf(voiceTag) - startOf(bedTag);
  const bed = profile.duckDb > 0 ? decode(resolve(compDir, unescapeAttr(bedSrc))) : null;
  const duck = bed ? carveApi.analyseCarveDuck(voice, bed, SAMPLE_RATE, profile, offset) : [];

  // Anything the author built by hand survives a carve; only the previous
  // carve's own nodes are replaced. That is what `fromCarve` is for.
  const existingChain = attrOf(bedTag, "data-fx-chain");
  const existingNodes = existingChain
    ? fxApi.parseAudioFxChain(unescapeAttr(existingChain)).nodes
    : [];
  const kept = existingNodes.filter((n) => !n.fromCarve);
  // Lanes belonging to the carve being replaced, addressed by the ids the OLD
  // nodes had. Taken before anything is minted: those ids are freed by the
  // replacement and a new node can be handed one of them, so reading them off the
  // new chain would keep exactly the stale lanes it is supposed to drop.
  const stalePrefixes = existingNodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);

  let claimed = { version: 1, nodes: kept };
  const mint = (node) => {
    const withId = { ...node, id: fxApi.mintAudioFxNodeId(claimed), fromCarve: true };
    claimed = { version: 1, nodes: [...claimed.nodes, withId] };
    return withId;
  };
  const bandNodes = bands.map((band) => mint(carveApi.carveBandsToChain([band]).nodes[0]));

  // A static carve holds one value, so its level match is the duck the voice
  // needs while it is actually speaking — the median, which ignores both the
  // pauses and the single loudest bar.
  const speaking = duck.filter((p) => p.v < 0).map((p) => p.v);
  const staticDuckDb = speaking.length
    ? (speaking.sort((a, b) => a - b)[Math.floor(speaking.length / 2)] ?? 0)
    : 0;
  const duckNode =
    duck.length > 0
      ? mint({
          type: "gain",
          enabled: true,
          params: {
            ...fxApi.defaultAudioFxParams("gain"),
            gain: args.dynamic ? 0 : staticDuckDb,
          },
        })
      : null;
  const chain = {
    version: 1,
    nodes: [...bandNodes, ...(duckNode ? [duckNode] : []), ...kept],
  };

  /**
   * One carve envelope as a lane on the BED's clock.
   *
   * A lane holds its first value backwards to the start of its own clip, so a bed
   * that begins before the voice needs an explicit "no cut" at zero or it starts
   * out ducked.
   */
  const laneFor = (id, points) => {
    const shifted = points
      .map((p) => ({ t: Number((p.t + offset).toFixed(3)), v: p.v }))
      .filter((p) => p.t >= 0);
    if ((shifted[0]?.t ?? 0) > 0) shifted.unshift({ t: 0, v: 0 });
    return shifted.length > 1 ? [{ target: `fx.${id}.gain`, points: shifted }] : [];
  };

  const carvedLanes = args.dynamic
    ? [
        ...carveApi
          .analyseCarveDynamics(voice, SAMPLE_RATE, bands)
          .flatMap((dyn, i) => (bandNodes[i]?.id ? laneFor(bandNodes[i].id, dyn.points) : [])),
        ...(duckNode?.id && duck.length > 0 ? laneFor(duckNode.id, duck) : []),
      ]
    : [];

  // Hand-drawn lanes are kept the same way hand-built nodes are: by dropping only
  // the ones that addressed the previous carve's nodes.
  const existingAutomation = attrOf(bedTag, "data-automation");
  const carriedLanes = existingAutomation
    ? (JSON.parse(unescapeAttr(existingAutomation)).lanes ?? []).filter(
        (lane) => !stalePrefixes.some((prefix) => String(lane.target).startsWith(prefix)),
      )
    : [];
  const lanes = [...carriedLanes, ...carvedLanes];

  const settings = { source: voiceEl.id, strength: args.strength, dynamic: args.dynamic };
  const written =
    ` data-fx-carve="${escapeAttr(JSON.stringify(settings))}"` +
    ` data-fx-chain="${escapeAttr(fxApi.serializeAudioFxChain(chain))}"` +
    (lanes.length > 0
      ? ` data-automation="${escapeAttr(JSON.stringify({ version: 1, lanes }))}"`
      : "");

  process.stdout.write(
    `carve  strength ${args.strength}${args.dynamic ? " dynamic" : " static"}\n` +
      `bands  ${bands.map((b) => `${b.freq}Hz ${b.gainDb}dB q${b.q}`).join(", ")}\n` +
      `level  ${
        duckNode
          ? args.dynamic
            ? `${duck.length}-point envelope, floor ${Math.min(...duck.map((p) => p.v))} dB`
            : `${staticDuckDb.toFixed(1)} dB held`
          : "no level match at this strength"
      }\n` +
      `lanes  ${carvedLanes.length} carve${carriedLanes.length ? ` + ${carriedLanes.length} kept` : ""}\n`,
  );
  if (args.dryRun) {
    process.stdout.write("dry run: nothing written\n");
    return;
  }

  let stripped = bedTag;
  for (const attr of ["data-fx-carve", "data-fx-chain", "data-automation"]) {
    stripped = stripped.replace(new RegExp(`\\s${attr}="[^"]*"`, "i"), "");
  }
  // Inserted before the tag's own closing ">", which is the only place they can
  // go: `stripped` is the opening tag alone, so appending would land outside it.
  const nextTag = stripped.replace(/\/?>$/, (close) => `${written}${close}`);
  if (nextTag === stripped) fail("attribute write produced no change — refusing to save");
  writeFileSync(compPath, html.replace(bedTag, nextTag));
  process.stdout.write(`wrote ${args.comp} (id="${bedEl.id}")\n`);
}

await main();
