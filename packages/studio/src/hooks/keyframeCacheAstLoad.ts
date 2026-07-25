/**
 * Reading a composition file's GSAP tweens into the keyframe cache: fetch,
 * selector -> element id resolution, and the clip-relative timing basis.
 * Split from useGsapTweenCache to keep that file under the 600-line limit.
 */
import type { GsapAnimation, GsapKeyframesData, ParsedGsap } from "@hyperframes/core/gsap-parser";
import { isStudioHoldSet } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import {
  clearKeyframeCacheForFile,
  elementCacheKeys,
  writeGsapAnimationsForElement,
} from "./gsapKeyframeCacheHelpers";
import { toClipKeyframes } from "./gsapShared";
import {
  deduplicateKeyframes,
  isStaticPositionHold,
  synthesizeFlatTweenKeyframes,
} from "./gsapTweenSynth";

function extractIdFromSelector(selector: string): string | null {
  const match = selector.match(/^#([\w-]+)/);
  return match ? match[1] : null;
}

/**
 * Resolve a tween's target selector to the ids of the element(s) it animates.
 * A bare `#id` resolves directly; anything else (a class like `.dot`, a group
 * `.a, .b`, or a descendant selector) is matched against the live preview DOM so
 * class/selector tweens (e.g. `gsap.from(".dot", {stagger})`) attribute to every
 * element they animate — not just one parsed from the string. Falls back to a
 * leading `#id` when there's no DOM (so the cache still populates pre-iframe).
 */
// fallow-ignore-next-line complexity
export function resolveSelectorElementIds(
  selector: string,
  doc: Document | null | undefined,
): string[] {
  const bareId = selector.match(/^#([\w-]+)$/);
  if (bareId) return [bareId[1]];
  if (!doc) {
    const lead = extractIdFromSelector(selector);
    return lead ? [lead] : [];
  }
  const ids = new Set<string>();
  for (const part of selector.split(",")) {
    const sel = part.trim();
    if (!sel) continue;
    try {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        if (el.id) ids.add(el.id);
      }
    } catch {
      const lead = extractIdFromSelector(sel);
      if (lead) ids.add(lead);
    }
  }
  return Array.from(ids);
}
/**
 * The slice of the parse response callers actually read. The endpoint returns
 * the full `ParsedGsap` (preamble/postamble and all), but nothing downstream of
 * this fetch touches the source-text fields, so the guard below only has to
 * vouch for what gets used.
 */
type ParsedGsapAnimations = Pick<
  ParsedGsap,
  "animations" | "multipleTimelines" | "unsupportedTimelinePattern"
>;

/**
 * A proxy, an error page, or a stale server can answer 200 with something that
 * has no `animations` array — the case where the old blind cast crashed on
 * `.animations.filter`.
 */
function hasAnimations(value: unknown): value is ParsedGsapAnimations {
  return (
    typeof value === "object" &&
    value !== null &&
    "animations" in value &&
    Array.isArray(value.animations)
  );
}

export async function fetchParsedAnimations(
  projectId: string,
  sourceFile: string,
): Promise<ParsedGsapAnimations | null> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-animations/${encodeURIComponent(sourceFile)}`,
      // Always re-read the freshly-parsed source; no per-call timestamp (which
      // would defeat caching forever and is a deterministic-render no-no).
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    if (!hasAnimations(parsed)) return null;
    // Studio-emitted pre-keyframe hold `set`s are an internal runtime detail (they
    // hold an element's first keyframe before its tween). They must not surface as
    // user animations — otherwise they pollute the keyframe cache / timeline diamonds.
    return { ...parsed, animations: parsed.animations.filter((a) => !isStudioHoldSet(a)) };
  } catch {
    return null;
  }
}

/**
 * Clip-relative timing basis for an element. Sub-composition internals (e.g. pills
 * inside a scene) aren't timeline clips themselves — they're derived at expand time
 * — so they're absent from `elements`. Without a basis, elDuration defaulted to 1
 * and clip-relative keyframe percentages blew past 100% (rendering off the clip).
 * Fall back to the sub-comp HOST's bounds, resolved via domClipChildren (the host's
 * data-composition-src is stripped in the rendered DOM, so we can't query it).
 */
export function resolveClipTimingBasis(
  elementId: string,
  sourceFile: string,
  elements: ReadonlyArray<{
    domId?: string;
    key?: string;
    id: string;
    start: number;
    duration: number;
  }>,
  domClipChildren: ReadonlyArray<{ id: string; hostId: string }>,
): { elStart: number; elDuration: number } {
  const direct = elements.find(
    (el) => el.domId === elementId || (el.key ?? el.id) === `${sourceFile}#${elementId}`,
  );
  if (direct) return { elStart: direct.start, elDuration: direct.duration };
  const hostId = domClipChildren.find((c) => c.id === elementId)?.hostId;
  const host = hostId
    ? elements.find((el) => el.domId === hostId || (el.key ?? el.id) === `index.html#${hostId}`)
    : undefined;
  return { elStart: host?.start ?? 0, elDuration: host?.duration ?? 1 };
}

/**
 * Read one composition file's tweens into the keyframe cache. Split out of the
 * hook so the effect can run it per file without re-nesting the whole body.
 */
// fallow-ignore-next-line complexity
export async function populateKeyframeCacheFromAst(
  projectId: string,
  sf: string,
  doc: Document | null | undefined,
): Promise<void> {
  const parsed = await fetchParsedAnimations(projectId, sf);
  if (!parsed) return;
  const { setKeyframeCache } = usePlayerStore.getState();
  clearKeyframeCacheForFile(sf);
  const { elements, domClipChildren } = usePlayerStore.getState();
  const mergedByElement = new Map<string, GsapKeyframesData>();
  const sourceByElement = new Map<string, GsapAnimation[]>();
  for (const anim of parsed.animations) {
    if (anim.hasUnresolvedKeyframes) continue;
    if (isStaticPositionHold(anim)) continue;
    const kfData = anim.keyframes ?? synthesizeFlatTweenKeyframes(anim);
    if (!kfData) continue;
    // Attribute the tween to every element it animates (handles class /
    // group / descendant selectors, not just `#id`).
    for (const id of resolveSelectorElementIds(anim.targetSelector, doc)) {
      // kfData is already resolved (real keyframes OR a synthesized flat
      // tween), so a flat tween joins the store like a keyframed one. No
      // property-group filter: this map must cover every tween the cache
      // below records, or expanded lanes have nothing to render.
      sourceByElement.set(id, [...(sourceByElement.get(id) ?? []), anim]);
      const { elStart, elDuration } = resolveClipTimingBasis(id, sf, elements, domClipChildren);
      const clipKeyframes = toClipKeyframes(kfData.keyframes, anim, elStart, elDuration);
      const existing = mergedByElement.get(id);
      if (existing) {
        existing.keyframes = deduplicateKeyframes([...existing.keyframes, ...clipKeyframes]);
      } else {
        mergedByElement.set(id, { ...kfData, keyframes: clipKeyframes });
      }
    }
  }
  for (const [id, kfData] of mergedByElement) {
    for (const key of elementCacheKeys(sf, id)) setKeyframeCache(key, kfData);
    writeGsapAnimationsForElement(sf, id, sourceByElement.get(id));
  }
}
