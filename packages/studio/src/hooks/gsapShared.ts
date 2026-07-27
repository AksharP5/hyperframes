/**
 * Shared GSAP primitives used across multiple hook files.
 * Centralises duplicated interfaces, constants, and small utilities
 * to reduce drift risk.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  absoluteToPercentage,
  resolveTweenStart,
  resolveTweenDuration,
} from "../utils/globalTimeCompiler";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Canonical interface for the iframe-hosted GSAP runtime. */
export interface IframeGsap {
  getProperty: (el: Element, prop: string) => number;
  set?: (target: string, vars: Record<string, number | string>) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

/**
 * A timeline write that applies an instantaneous value and then holds it.
 * `set()` is always a hold; authored `to()` / `fromTo()` tweens are holds only
 * when their resolved duration is exactly zero.
 */
export function isInstantHold(animation: GsapAnimation): boolean {
  return (
    animation.method === "set" ||
    ((animation.method === "to" || animation.method === "fromTo") &&
      resolveTweenDuration(animation) === 0)
  );
}

// ── Selector resolution ───────────────────────────────────────────────────────

/**
 * Get a CSS selector string from a DomEditSelection.
 * Returns `#id` if the selection has an id, otherwise the raw selector,
 * or null if neither exists.
 */
/**
 * A CSS-valid selector for an element id. `#id` for a valid CSS identifier,
 * otherwise an `[id="..."]` attribute selector. IDs that start with a digit
 * (e.g. "01-hook-hero-word") make `#id` an invalid selector, so
 * `document.querySelector("#01-...")` / GSAP's `querySelectorAll` throw a
 * SyntaxError — which surfaces as a masked cross-origin "Script error." and
 * crashes the preview the moment such a target is committed (e.g. dragging).
 */
// Conservative: matches only ids that are unquestionably safe as a `#id`
// selector — ASCII identifier, starts with a letter/underscore (or a single
// leading hyphen), no dots/colons/spaces/digits-first. Anything it rejects
// (digit-leading like "01-hook-...", dots, spaces, non-ASCII, …) falls through
// to the attribute selector below, which is always valid. It can only ever err
// toward the safe form, never toward a `#id` that throws — and, unlike
// `CSS.escape`, it needs no browser global (this runs in node tests too).
const SAFE_HASH_ID = /^-?[A-Za-z_][\w-]*$/;

/**
 * How close (in tween-%) a playhead has to be to count as sitting ON an existing
 * keyframe. Every "is there already a keyframe here?" test shares this: with two
 * different tolerances in play, one path decided "no keyframe here, append one"
 * while another decided "yes, edit that one", and a drag near a waypoint left two
 * keyframes a fraction of a percent apart.
 */
export const KEYFRAME_PCT_MATCH = 1;

export function idSelector(id: string): string {
  // A `#id` selector is only valid for a CSS identifier. IDs that start with a
  // digit (e.g. "01-hook-hero-word") make `document.querySelector("#01-...")` and
  // GSAP's `querySelectorAll` throw a SyntaxError — surfacing as a masked
  // cross-origin "Script error." that crashes the preview the moment such a
  // target is committed (e.g. dragging the element). Address those via an
  // attribute selector instead (quotes/backslashes escaped for the string).
  return SAFE_HASH_ID.test(id) ? `#${id}` : `[id="${id.replace(/(["\\])/g, "\\$1")}"]`;
}

/**
 * Inverse of {@link idSelector}: the element id a target selector addresses, or
 * null for a selector that is not id-based (a class, a tag, a descendant path).
 *
 * Both shapes have to be read back, not just `#id`. Every writer emits through
 * `idSelector`, so a digit-leading, dotted or otherwise CSS-unsafe id lands in
 * the source as `[id="01-hook-hero"]`. A reader that only matched `#id` saw no
 * id at all for those elements and skipped them — which is how the post-commit
 * keyframe-cache refresh silently stopped running for exactly the ids
 * `idSelector` was added to support.
 */
export function idFromSelector(selector: string | undefined | null): string | null {
  if (!selector) return null;
  const hash = selector.match(/^#([\w-]+)/);
  if (hash) return hash[1] ?? null;
  const attribute = selector.match(/^\[id="((?:\\.|[^"\\])*)"\]/);
  if (!attribute) return null;
  // Undo the quote/backslash escaping idSelector applies.
  return (attribute[1] ?? "").replace(/\\(["\\])/g, "$1");
}

export function selectorFromSelection(selection: DomEditSelection): string | null {
  if (selection.id) return idSelector(selection.id);
  if (selection.selector) return selection.selector;
  return null;
}

// ── Percentage computation ────────────────────────────────────────────────────

/**
 * Resolve the timing basis used by editor keyframes. The timeline renders a
 * duration-less tween across its owning clip, so mutations must use that same
 * duration instead of silently falling back to GSAP's 0.5s default.
 */
export function resolveEditableTweenDuration(
  animation: GsapAnimation,
  selection: DomEditSelection,
): number {
  const clipDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "");
  return resolveTweenDuration(
    animation,
    Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : 0.5,
  );
}

/**
 * Compute the current playback percentage within an element's animation range.
 * Uses the animation's resolved timing if available, otherwise falls back to
 * the element's data-start / data-duration attributes.
 */
export function computeElementPercentage(
  currentTime: number,
  selection: DomEditSelection,
  animation?: GsapAnimation | null,
): number {
  if (animation) {
    const start = resolveTweenStart(animation);
    const duration = resolveEditableTweenDuration(animation, selection);
    if (duration <= 0) return 0;
    if (start !== null) {
      return absoluteToPercentage(currentTime, start, duration);
    }
  }
  const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
  return absoluteToPercentage(currentTime, elStart, elDuration);
}

// ── Iframe accessors ──────────────────────────────────────────────────────────

/** Safely retrieve the GSAP runtime from the preview iframe. */
export function getIframeGsap(iframe: HTMLIFrameElement | null): IframeGsap | null {
  if (!iframe?.contentWindow) return null;
  try {
    const gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
    return gsap?.getProperty ? gsap : null;
  } catch {
    return null;
  }
}

/** Safely query an element inside the preview iframe's document. */
export function queryIframeElement(
  iframe: HTMLIFrameElement | null,
  selector: string,
): Element | null {
  try {
    return iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
}

// ── Keyframe parsing ──────────────────────────────────────────────────────────

export interface ParsedPercentageKeyframes {
  keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
  easeEach?: string;
}

function collectAnimatableKeyframeProperties(entry: object): Record<string, number | string> {
  const properties: Record<string, number | string> = {};
  for (const [property, value] of Object.entries(entry)) {
    if (property === "ease") continue;
    if (typeof value === "number") properties[property] = Math.round(value * 1000) / 1000;
    else if (typeof value === "string") properties[property] = value;
  }
  return properties;
}

/**
 * Parse a GSAP percentage-keyframe object (`{ "0%": { x: 10 }, "100%": { x: 200 } }`)
 * into a sorted array of `{ percentage, properties }` entries.
 * Returns `null` when the object contains no valid keyframe entries.
 */
export function parsePercentageKeyframes(
  kfObj: Record<string, unknown>,
): ParsedPercentageKeyframes | null {
  const keyframes: ParsedPercentageKeyframes["keyframes"] = [];
  let easeEach: string | undefined;

  // GSAP array-form keyframes — `keyframes: [{x,y}, {x,y}, ...]` — are spread
  // evenly across the tween by default: GSAP gives each entry an equal share of
  // the duration unless an entry carries its own `duration`/`delay`, which the
  // studio never emits. So entry i of n maps to i/(n-1)*100% (n=4 → 0/33.3/66.7/100).
  // Index spacing counts EVERY array slot, including a degenerate entry that
  // contributes no animatable prop (it's still a slot GSAP allocates a position
  // to), so dropping such an entry from the output below must NOT shift the others.
  // A per-entry `ease` is a segment ease, not a keyframe value, so it's skipped as
  // a property; there is no array-form `easeEach` (that's an object-form sibling key).
  // (The object form further down uses explicit "0%" keys instead.) Without this
  // branch, array-keyframed tweens (e.g. a multi-point shuttle) read as null → no
  // motion path.
  if (Array.isArray(kfObj)) {
    const steps = kfObj as unknown[];
    steps.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") return;
      const percentage = steps.length > 1 ? Math.round((i / (steps.length - 1)) * 1000) / 10 : 0;
      const properties = collectAnimatableKeyframeProperties(entry);
      if (Object.keys(properties).length > 0) keyframes.push({ percentage, properties });
    });
    return keyframes.length > 0 ? { keyframes } : null;
  }

  for (const [key, val] of Object.entries(kfObj)) {
    if (key === "easeEach") {
      if (typeof val === "string") easeEach = val;
      continue;
    }
    const pctMatch = key.match(/^(\d+(?:\.\d+)?)%$/);
    if (!pctMatch || !val || typeof val !== "object") continue;
    const percentage = parseFloat(pctMatch[1]);
    const properties = collectAnimatableKeyframeProperties(val);
    if (Object.keys(properties).length > 0) {
      keyframes.push({ percentage, properties });
    }
  }

  if (keyframes.length === 0) return null;
  keyframes.sort((a, b) => a.percentage - b.percentage);
  return { keyframes, easeEach };
}

// ── Time conversion ───────────────────────────────────────────────────────────

/** Convert a tween-relative percentage to an absolute time. */
export function toAbsoluteTime(tweenPos: number, tweenDur: number, percentage: number): number {
  return tweenPos + (percentage / 100) * tweenDur;
}

/**
 * An absolute time as a percentage of a timeline clip, at the one precision every
 * keyframe-cache writer must share. 0.001% keeps a beat-snapped keyframe centered
 * on the beat dot, and because selection keys embed this number, a writer that
 * rounds coarser would orphan a live selection the moment it rewrites the cache.
 * A zero-length clip has no percentage to give, so the tween-% passes through.
 */
export function toClipPercentage(
  absoluteTime: number,
  clipStart: number,
  clipDuration: number,
  fallbackPercentage: number,
): number {
  if (clipDuration <= 0) return fallbackPercentage;
  return Math.round(((absoluteTime - clipStart) / clipDuration) * 100000) / 1000;
}

/**
 * One keyframe-cache row per tween keyframe: the percentage re-based onto the
 * clip, the original tween percentage kept alongside it, and the animation
 * identity every lane and selection key needs. Shared by the cache writers so
 * they cannot drift in precision or in which identity fields they record.
 */
export function toClipKeyframes<T extends { percentage: number }>(
  source: readonly T[],
  anim: GsapAnimation,
  clipStart: number,
  clipDuration: number,
): Array<
  T & {
    tweenPercentage: number;
    propertyGroup: GsapAnimation["propertyGroup"];
    animationId: string;
  }
> {
  const tweenStart = anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
  // A duration-less tween spans the clip, the same rule the edit paths use
  // (resolveEditableTweenDuration). A fixed 1s here put its keyframes at a
  // percentage no editor agreed with.
  const tweenDuration = anim.duration ?? clipDuration;
  return source.map((keyframe) => ({
    ...keyframe,
    percentage: toClipPercentage(
      toAbsoluteTime(tweenStart, tweenDuration, keyframe.percentage),
      clipStart,
      clipDuration,
      keyframe.percentage,
    ),
    tweenPercentage: keyframe.percentage,
    propertyGroup: anim.propertyGroup,
    animationId: anim.id,
  }));
}
