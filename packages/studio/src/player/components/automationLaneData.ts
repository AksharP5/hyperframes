/**
 * Reading an element's automation, shared by the lane UI and the row layout.
 *
 * The attributes are carried on TimelineElement verbatim rather than parsed at
 * the manifest boundary: the lane reads and writes them, and round-tripping
 * through the attribute is what keeps the lane, the property panel and the
 * running audio graph on one source of truth.
 *
 * Both parse the same two attributes: the layout needs the lane count to
 * reserve height, the lanes need the lanes themselves. Parsing is cached by the
 * attribute text so the identity only changes when the text does — the lane's
 * drag draft compares against that identity, and a fresh object on every
 * playhead tick would throw away the drag in progress.
 */

import {
  parseAutomation,
  parseAutomationTarget,
  resolveAutomation,
  resolveAutomationRange,
  type HfAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { parseAudioFxChain, type HfAudioFxChain } from "@hyperframes/core/audio-fx";
import type { TimelineElement } from "../store/playerStore";

const EMPTY: HfAutomation = { version: 1, lanes: [] };

const chainCache = new Map<string, HfAudioFxChain | null>();
const automationCache = new Map<string, HfAutomation>();
const CACHE_LIMIT = 64;

/**
 * Parse once per distinct attribute text, keeping the same object until the text
 * changes — the lane compares its drag draft against that identity.
 *
 * Eviction drops the oldest entry rather than clearing the map: clearing would
 * change the identity of every lane's automation at once, and any lane mid-drag
 * would release its draft and jump back to the stored value.
 */
function cached<T>(store: Map<string, T>, key: string, build: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) {
    // Re-insert so the entry counts as recently used.
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const value = build();
  if (store.size >= CACHE_LIMIT) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, value);
  return value;
}

/** The element's FX chain, or null when it has none or it is unreadable. */
export function elementFxChain(element: TimelineElement): HfAudioFxChain | null {
  const raw = element.fxChain;
  if (!raw) return null;
  return cached(chainCache, raw, () => {
    try {
      return parseAudioFxChain(raw);
    } catch {
      return null;
    }
  });
}

/**
 * The element's automation, bound to its chain the same way preview and the
 * render bind it: a lane whose effect has been deleted is dropped rather than
 * drawn on the wrong axis.
 */
export function elementAutomation(element: TimelineElement): HfAutomation {
  const raw = element.automation;
  if (!raw) return EMPTY;
  const chain = elementFxChain(element);
  // Both texts key the entry: the resolved lanes depend on the chain too. Joined
  // through a separator no attribute can contain.
  return cached(automationCache, `${raw}\u0000${element.fxChain ?? ""}`, () => {
    try {
      const resolved = resolveAutomation(parseAutomation(raw), chain ?? undefined);
      return { ...resolved, lanes: orderLanes(resolved.lanes, chain) };
    } catch {
      // Unreadable automation draws no lanes rather than breaking the row.
      return EMPTY;
    }
  });
}

/** Lanes in the order they are drawn, one row each. */
export function elementAutomationLanes(element: TimelineElement): HfAutomationLane[] {
  return elementAutomation(element).lanes;
}

/** The frequency the lane's effect sits at, when it has one. */
function laneFrequency(target: string, chain: HfAudioFxChain | null): number | null {
  const parsed = parseAutomationTarget(target);
  if (!parsed || parsed.kind !== "fx") return null;
  const node = chain?.nodes.find((n) => n.id === parsed.nodeId);
  const freq = node?.params?.["frequency"];
  return typeof freq === "number" ? freq : null;
}

/**
 * Lane order: the audible spectrum, top down, then everything else.
 *
 * A stack of EQ bands is read as a spectrum, so it has to be laid out like one —
 * high at the top, the way every analyser and every EQ curve is drawn. Attribute
 * order is whatever minted the nodes, which for a carve is ascending: exactly
 * upside down. Lanes with no frequency to place them — a level stage, the track's
 * own volume — keep their written order and sit under the bands, like a fader
 * below the EQ section of a channel strip.
 *
 * Sorted here, in the one function both the canvas lanes and the label column
 * read, because a label whose row disagrees with the envelope it names is worse
 * than either order.
 */
function orderLanes(lanes: HfAutomationLane[], chain: HfAudioFxChain | null): HfAutomationLane[] {
  const withFreq: { lane: HfAutomationLane; freq: number }[] = [];
  const rest: HfAutomationLane[] = [];
  for (const lane of lanes) {
    const freq = laneFrequency(lane.target, chain);
    if (freq === null) rest.push(lane);
    else withFreq.push({ lane, freq });
  }
  withFreq.sort((a, b) => b.freq - a.freq);
  return [...withFreq.map((e) => e.lane), ...rest];
}

/** A frequency as an author reads it: 400 Hz, 1.6 kHz, 10 kHz. */
export function formatHz(freq: number): string {
  if (freq < 1000) return `${Math.round(freq)} Hz`;
  const k = freq / 1000;
  return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))} kHz`;
}

/**
 * What a lane is called in the timeline, as its two lines.
 *
 * `name` is the effect and, when it has one, the frequency it sits at: "Peaking
 * EQ 1.6 kHz". The frequency is what tells two bands apart — three lanes all
 * reading "Peaking EQ" say nothing about which is which — and the effect still
 * has to be named, since a chain mixes filter types and a bare frequency does not
 * say whether it is a bell or a shelf.
 *
 * `param` is which knob the envelope drives, on its own line: a band can carry a
 * gain lane and a Q lane, and stacking the two lines is what keeps a name legible
 * in a column this narrow instead of truncating mid-word.
 *
 * Null when the target does not resolve against the chain — the same condition
 * that stops the lane being drawn at all.
 */
export function automationLaneLabelParts(
  target: string,
  chain: HfAudioFxChain | null,
): { name: string; param: string } | null {
  const range = resolveAutomationRange(target, chain ?? undefined);
  if (!range) return null;
  // The registry's label is "<effect> · <param>", or just "<param>" for volume.
  const parts = range.label.split(" · ");
  const param = parts.at(-1) ?? range.label;
  const effect = parts.length > 1 ? parts.slice(0, -1).join(" · ") : null;
  const freq = laneFrequency(target, chain);
  const name = [effect, freq === null ? null : formatHz(freq)].filter(Boolean).join(" ");
  return { name: name || param, param: name ? param : "" };
}

/** The whole label on one line, for a tooltip or an accessible name. */
export function automationLaneLabel(target: string, chain: HfAudioFxChain | null): string | null {
  const parts = automationLaneLabelParts(target, chain);
  if (!parts) return null;
  return parts.param ? `${parts.name} · ${parts.param}` : parts.name;
}
