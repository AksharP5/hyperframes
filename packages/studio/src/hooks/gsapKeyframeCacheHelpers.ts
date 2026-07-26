/**
 * Helpers for reading/writing the GSAP keyframe cache in the player store.
 * Extracted from useGsapScriptCommits to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type KeyframeCacheEntry } from "../player/store/playerStore";
import { toClipKeyframes } from "./gsapShared";
import { deduplicateKeyframes, synthesizeFlatTweenKeyframes } from "./gsapTweenSynth";

export function updateKeyframeCacheFromParsed(
  animations: GsapAnimation[],
  targetPath: string,
  selectionId: string | undefined,
  mutation: Record<string, unknown>,
): void {
  const { setKeyframeCache, elements } = usePlayerStore.getState();
  const idsWithKeyframes = new Set<string>();
  const merged = new Map<string, KeyframeCacheEntry>();
  const sourceAnimations = new Map<string, GsapAnimation[]>();
  for (const anim of animations) {
    const id = anim.targetSelector.match(/^#([\w-]+)/)?.[1];
    const kfSource =
      anim.keyframes?.keyframes ?? synthesizeFlatTweenKeyframes(anim)?.keyframes ?? [];
    if (!id || kfSource.length === 0) continue;
    idsWithKeyframes.add(id);
    // Every tween that fed keyframeCache also lands in gsapAnimations, group or
    // not: a mixed-group tween (`{ x, opacity }` classifies to undefined) used to
    // cache diamonds with no source animation behind them, so the collapsed row
    // drew keyframes the expanded lanes couldn't render. Lane consumers do the
    // group filtering themselves (animationContributesLane).
    sourceAnimations.set(id, [...(sourceAnimations.get(id) ?? []), anim]);

    // Convert tween-relative percentages to clip-relative so diamonds
    // render at the correct position within the timeline clip.
    const timelineEl = elements.find(
      (el) => el.domId === id || (el.key ?? el.id) === `${targetPath}#${id}`,
    );
    const clipKeyframes = toClipKeyframes(
      kfSource,
      anim,
      timelineEl?.start ?? 0,
      timelineEl?.duration ?? 1,
    );

    const existing = merged.get(id);
    if (existing) {
      // deduplicateKeyframes owns the same-% merge (including the easeAmbiguous
      // flag downstream lanes read); a second copy of that rule here is how the
      // two writers drift.
      existing.keyframes = deduplicateKeyframes([...existing.keyframes, ...clipKeyframes]);
    } else {
      merged.set(id, {
        ...anim.keyframes,
        format: anim.keyframes?.format ?? "percentage",
        keyframes: clipKeyframes,
      });
    }
  }
  for (const [id, entry] of merged) {
    for (const key of elementCacheKeys(targetPath, id)) setKeyframeCache(key, entry);
    writeGsapAnimationsForElement(targetPath, id, sourceAnimations.get(id));
  }
  const targetId =
    (mutation as { targetSelector?: string }).targetSelector?.match(/^#([\w-]+)/)?.[1] ??
    selectionId;
  if (targetId && !idsWithKeyframes.has(targetId)) {
    clearKeyframeCacheForElement(targetPath, targetId);
  }
}

/**
 * Clear every keyframe-cache key variant written for an element: the
 * source-prefixed key, the index.html fallback, and the bare element id.
 * Writes set all three (see updateKeyframeCacheFromParsed and
 * usePopulateKeyframeCacheForFile). PropertyPanel's keyframe nav reads the bare
 * id directly (`element.id`), and other consumers (timeline diamonds, the
 * preview overlay) fall back to the bare id when an element has no
 * source-prefixed key — so a clear that drops only the prefixed keys leaves the
 * bare entry behind and those readers keep showing keyframes the element no
 * longer has. Each delete is guarded by `has` so an absent key doesn't allocate
 * a new cache map and re-render every subscriber.
 */
export function clearKeyframeCacheForElement(sourceFile: string, elementId: string): void {
  const { keyframeCache, setKeyframeCache, gsapAnimations, setGsapAnimations } =
    usePlayerStore.getState();
  const keys = elementCacheKeys(sourceFile, elementId);
  for (const key of keys) {
    if (keyframeCache.has(key)) setKeyframeCache(key, undefined);
    if (gsapAnimations.has(key)) setGsapAnimations(key, undefined);
  }
}

/**
 * Clear every cached element of `sourceFile` before a full re-scan repopulates
 * it. Only the file's OWN prefixed keys name the ids to clear: every write sets
 * the prefixed key (see elementCacheKeys), so the file's elements are all
 * reachable that way, and clearKeyframeCacheForElement then takes the
 * index.html alias and the bare key with them — an element whose keyframes were
 * removed (and so is absent from the re-scan) leaves no stale bare entry
 * behind. Reading the alias prefix here instead would collect ids owned by
 * OTHER files, and several files re-scan concurrently, so this file's clear
 * would wipe the entries a sibling file had just written.
 */
export function clearKeyframeCacheForFile(sourceFile: string): void {
  const { keyframeCache, gsapAnimations } = usePlayerStore.getState();
  const sfPrefix = `${sourceFile}#`;
  const ids = new Set<string>();
  for (const key of [...keyframeCache.keys(), ...gsapAnimations.keys()]) {
    if (!key.startsWith(sfPrefix)) continue;
    ids.add(key.slice(sfPrefix.length));
  }
  for (const id of ids) {
    clearKeyframeCacheForElement(sourceFile, id);
  }
}

function elementCacheKeys(sourceFile: string, elementId: string): string[] {
  return sourceFile === "index.html"
    ? [`index.html#${elementId}`, elementId]
    : [`${sourceFile}#${elementId}`, `index.html#${elementId}`, elementId];
}

export function writeGsapAnimationsForElement(
  sourceFile: string,
  elementId: string,
  animations: GsapAnimation[] | undefined,
): void {
  const { setGsapAnimations } = usePlayerStore.getState();
  for (const key of elementCacheKeys(sourceFile, elementId)) {
    setGsapAnimations(key, animations);
  }
}

function buildCacheKey(sourceFile: string, elementId: string): string {
  return `${sourceFile}#${elementId}`;
}

export function readKeyframeSnapshot(
  sourceFile: string,
  elementId: string | null | undefined,
): KeyframeCacheEntry | undefined {
  if (!elementId) return undefined;
  return usePlayerStore.getState().keyframeCache.get(buildCacheKey(sourceFile, elementId));
}

export function writeKeyframeCache(
  sourceFile: string,
  elementId: string | null | undefined,
  data: KeyframeCacheEntry | undefined,
): void {
  if (!elementId) return;
  usePlayerStore.getState().setKeyframeCache(buildCacheKey(sourceFile, elementId), data);
}
