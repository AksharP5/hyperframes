import { memo, useEffect, useRef, useState } from "react";
import { BEAT_BAND_H } from "./BeatStrip";
import {
  KEYFRAME_DRAG_THRESHOLD_PX,
  previewClipPct,
  resolveKeyframeDrag,
} from "../../components/editor/keyframeDrag";
import { TimelineDiamondConnectors } from "./TimelineDiamondConnectors";
import { clipToTweenPercentage } from "../../components/editor/KeyframeNavigation";
import { LANE_H } from "./timelineLayout";
import { timelineKeyframeSelectionKey } from "./timelineKeyframeIdentity";
import {
  DIAMOND_RATIO,
  KF_MAX_PCT,
  KF_MIN_PCT,
  keyframeTarget,
  type DragState,
  type TimelineClipDiamondsProps,
  type TimelineDiamondKeyframe,
  type TimelineDiamondLaneProps,
} from "./timelineDiamondTypes";

export type { TimelineDiamondKeyframe } from "./timelineDiamondTypes";

// Floor for a diamond's clickable width. The visual size still narrows to the
// neighbour gap so packed diamonds stay individually readable, but the hit box
// stops there: at the zoom floor the gap alone left a ~7px target, which is
// neither hittable nor selectable with any accuracy. Boxes may overlap slightly
// below this width; each diamond still owns the half-gap around its own centre.
const KF_MIN_HIT_W = 12;

/** A clip-% is a float division, so a raw tooltip reads `25.032499999999995%`. */
function roundPct(percentage: number): number {
  return Math.round(percentage * 1000) / 1000;
}

export const TimelineDiamondLane = memo(function TimelineDiamondLane({
  keyframesData,
  clipWidthPx,
  clipHeightPx,
  beatsActive,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
  onMoveKeyframe,
  onSelectSegment,
  suppressClickRef,
  groupAware = false,
  globalEase = "none",
}: TimelineDiamondLaneProps) {
  // Hooks must run before the early return below.
  const dragRef = useRef<DragState | null>(null);
  // Pending retime destination (clip + tween %) per keyframe key, so a rapid
  // second drag composes from where the first move left the keyframe (whose
  // cache entry has not rebuilt yet) instead of the stale rendered value.
  const pendingRetimeRef = useRef<Map<string, { clipPct: number; tweenPct: number }> | null>(null);
  // Lazy: `useRef(new Map())` allocates a Map on every render and throws all but
  // the first away, once per mounted lane.
  pendingRetimeRef.current ??= new Map();
  const pendingRetimes = pendingRetimeRef.current;
  useEffect(() => {
    // Clear a pending entry once the authoritative cache reflects THAT keyframe
    // at ~its destination. Match by tolerance, not equality: cache writers round
    // clip %s, so an exact check would leak an entry after every successful
    // retime. Match by identity too: a bare "some keyframe is near that %" test
    // cleared the entry whenever an unrelated sibling happened to sit there,
    // which is easy to hit on an evenly spaced row.
    const pendingEntries = pendingRetimeRef.current;
    if (!pendingEntries) return;
    for (const [key, pending] of pendingEntries) {
      const settled = keyframesData.keyframes.some(
        (k) =>
          timelineKeyframeSelectionKey(elementId, keyframeTarget(k)) === key &&
          Math.abs(k.percentage - pending.clipPct) < 0.2,
      );
      if (settled) pendingEntries.delete(key);
    }
  }, [keyframesData.keyframes, elementId]);
  // Visual-only preview of the dragged diamond's clip-% — no runtime/GSAP hold
  // (that optimistic hold was the #1763 flake). The atomic move-keyframe commit
  // on drop re-keys the diamond from source.
  const [preview, setPreview] = useState<{ kfKey: string; clipPct: number } | null>(null);
  // One preview render per frame: a 120Hz trackpad fires pointermove far faster
  // than the lane can repaint, and every diamond in the row re-evaluates its
  // memo on each of those renders.
  const previewFrameRef = useRef<number | null>(null);
  const cancelPreviewFrame = () => {
    if (previewFrameRef.current === null) return;
    cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
  };
  // Escape backs out of an in-flight retime, the way clip and element drags
  // already do. Nothing was written yet (the commit happens on pointerup), so
  // dropping the preview is the whole undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current || dragRef.current.cancelled) return;
      dragRef.current.cancelled = true;
      cancelPreviewFrame();
      setPreview(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      cancelPreviewFrame();
    };
  }, []);
  // The button element can re-render (reposition/unmount) synchronously from
  // the state updates onClickKeyframe/onMoveKeyframe trigger, before the
  // browser gets to auto-synthesize the "click" event that normally follows
  // pointerdown+pointerup on a button. That orphaned click then fires on
  // whatever ancestor is still there — the clip wrapper — whose own onClick
  // toggles selection off when the clip is already selected (the state a
  // diamond click always happens in). Suppressing it here is the same fix
  // already used for clip drag/resize in useTimelineClipDrag.ts.
  const suppressNextClick = () => {
    if (!suppressClickRef) return;
    suppressClickRef.current = true;
    requestAnimationFrame(() => {
      suppressClickRef.current = false;
    });
  };

  if (clipWidthPx < 20) return null;

  // When the beat strip occupies the top band, shrink the diamonds and center
  // them in the remaining bottom region so they don't collide with it.
  // One consistent keyframe-diamond size everywhere (clip bars + property lanes),
  // matching the property-lane size (LANE_H · ratio). Beat-strip tracks still
  // shrink to fit under the strip.
  const diamondSize = beatsActive
    ? Math.round(clipHeightPx * 0.45)
    : Math.round(LANE_H * DIAMOND_RATIO);
  const centerY = beatsActive ? BEAT_BAND_H + (clipHeightPx - BEAT_BAND_H) / 2 : clipHeightPx / 2;
  const sorted = keyframesData.keyframes
    .filter((kf) => kf.percentage >= KF_MIN_PCT && kf.percentage <= KF_MAX_PCT)
    .sort((a, b) => a.percentage - b.percentage);
  // The neighbour clamp bounds a dragged diamond between its immediate siblings
  // so a retime can't reorder the tween. Siblings means "keyframes of the SAME
  // tween": a merged row interleaves several animations, and two of them
  // colliding at one percentage would otherwise pin each other's diamonds in
  // place — the drag clamped back onto its own position and resolved to a click.
  const siblingRowOf = (keyframe: TimelineDiamondKeyframe) =>
    keyframe.animationId === undefined
      ? sorted
      : sorted.filter((k) => k.animationId === keyframe.animationId);
  // Compose each sibling's pending destination in first: clamping against
  // cached positions while the dragged keyframe reads its pending one let a
  // second drag cross a neighbour that had already moved past it. Built once
  // per render, keyed by tween: every diamond of a row needs the same row, and
  // rebuilding + re-sorting it inside the marker loop below made this
  // O(keyframes squared) allocations on every playhead tick.
  const pendingClipPctOf = (keyframe: TimelineDiamondKeyframe) =>
    pendingRetimes.get(timelineKeyframeSelectionKey(elementId, keyframeTarget(keyframe)))
      ?.clipPct ?? keyframe.percentage;
  const siblingRows = new Map<
    string | undefined,
    { keyframes: TimelineDiamondKeyframe[]; clipPcts: number[] }
  >();
  for (const keyframe of sorted) {
    if (siblingRows.has(keyframe.animationId)) continue;
    const row = siblingRowOf(keyframe)
      .map((k) => ({ keyframe: k, clipPct: pendingClipPctOf(k) }))
      .sort((a, b) => a.clipPct - b.clipPct);
    siblingRows.set(keyframe.animationId, {
      keyframes: row.map((s) => s.keyframe),
      clipPcts: row.map((s) => s.clipPct),
    });
  }
  const centerXOf = (percentage: number) =>
    Math.max(0, Math.min(clipWidthPx, (percentage / 100) * clipWidthPx));
  // One record per diamond, carrying its own geometry, so the connector and
  // button passes below read neighbours as values instead of index lookups.
  const markers = sorted.map((keyframe, index) => {
    const centerX = centerXOf(keyframe.percentage);
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const previousGap = previous ? centerX - centerXOf(previous.percentage) : Infinity;
    const nextGap = next ? centerXOf(next.percentage) - centerX : Infinity;
    const nearestGap = Math.max(1, Math.min(previousGap, nextGap));
    const gapWidth = Math.min(diamondSize, nearestGap);
    return {
      keyframe,
      centerX,
      hitWidth: Math.max(KF_MIN_HIT_W, gapWidth),
      visualSize: gapWidth === diamondSize ? diamondSize : Math.max(2, gapWidth - 2),
    };
  });
  const baseColor = isSelected ? accentColor : "#a3a3a3";
  const baseOpacity = isSelected ? 0.4 : 0.25;
  const canDrag = isSelected && !!onMoveKeyframe;

  return (
    <div
      className="absolute inset-0"
      style={{
        // Above the clip's trim-handle strips (TimelineClip.tsx, z-index 4) so
        // a keyframe sitting in the first/last ~14px of the clip stays
        // clickable instead of being covered by the resize handle. This div
        // establishes its own stacking context (position + z-index), so the
        // diamonds' own z-index (1/2) can't escape it on their own — the bump
        // has to happen here.
        zIndex: 5,
        pointerEvents: "none",
      }}
    >
      <TimelineDiamondConnectors
        markers={markers}
        centerY={centerY}
        baseColor={baseColor}
        baseOpacity={baseOpacity}
        groupAware={groupAware}
        globalEase={globalEase}
        keyframeTarget={keyframeTarget}
        onSelectSegment={onSelectSegment}
      />

      {markers.map((marker, i) => {
        const kf = marker.keyframe;
        const target = keyframeTarget(kf);
        const kfKey = timelineKeyframeSelectionKey(elementId, target);
        // Clamp against this keyframe's own tween, not the whole merged row.
        const siblingRow = siblingRows.get(kf.animationId);
        const siblingClipPcts = siblingRow?.clipPcts ?? [];
        const siblingIndex = siblingRow?.keyframes.indexOf(kf) ?? -1;
        // While dragging this diamond, render it at the live preview clip-%.
        const renderPct = preview?.kfKey === kfKey ? preview.clipPct : kf.percentage;
        // Center the marker's non-overlapping hit region ON its keyframe %, so
        // the diamond's midpoint sits exactly on the playhead/ruler x for that time.
        // The 0% diamond's left half lands in the reserved left gutter (the
        // content origin is inset past the label column, Figma-style) so it stays
        // fully visible instead of being clipped by the sticky label column.
        const leftPx = (renderPct / 100) * clipWidthPx - marker.hitWidth / 2;
        const isKfSelected = selectedKeyframes.has(kfKey);
        const atPlayhead = isSelected && Math.abs(kf.percentage - currentPercentage) < 0.5;
        const isHighlighted = isKfSelected || atPlayhead;
        const color = isHighlighted ? accentColor : "#a3a3a3";

        const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (canDrag) {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            dragRef.current = {
              kfKey,
              startX: e.clientX,
              lastX: e.clientX,
              index: siblingIndex,
              fromClipPct: pendingRetimes.get(kfKey)?.clipPct ?? kf.percentage,
              moved: false,
            };
          }
        };
        const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = dragRef.current;
          if (!d || d.kfKey !== kfKey || d.cancelled) return;
          d.lastX = e.clientX;
          if (!d.moved && Math.abs(e.clientX - d.startX) >= KEYFRAME_DRAG_THRESHOLD_PX) {
            d.moved = true;
          }
          if (!d.moved || previewFrameRef.current !== null) return;
          previewFrameRef.current = requestAnimationFrame(() => {
            previewFrameRef.current = null;
            const live = dragRef.current;
            if (!live || live.kfKey !== kfKey || live.cancelled) return;
            setPreview({
              kfKey,
              clipPct: previewClipPct({
                pointerDownX: live.startX,
                pointerMoveX: live.lastX,
                clipWidthPx,
                draggedClipPct: live.fromClipPct,
                draggedIndex: live.index,
                sortedClipPcts: siblingClipPcts,
              }),
            });
          });
        };
        const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = dragRef.current;
          if (d?.kfKey === kfKey && d.cancelled) {
            // Escape already ended this drag; the release is not a click.
            dragRef.current = null;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            suppressNextClick();
            return;
          }
          // No drag armed (canDrag false / non-primary press) → treat as a click.
          if (!d || d.kfKey !== kfKey) {
            if (e.button !== 0) return;
            suppressNextClick();
            if (e.shiftKey) onShiftClickKeyframe?.(target);
            else onClickKeyframe?.(target);
            return;
          }
          e.stopPropagation();
          dragRef.current = null;
          cancelPreviewFrame();
          setPreview(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          suppressNextClick();
          // Single-diamond retime by design: a multi-select drag would have to
          // move every selected keyframe as one mutation, which the script ops
          // do not express yet. Selecting several and dragging one moves only
          // the dragged one.
          const res = resolveKeyframeDrag({
            pointerDownX: d.startX,
            pointerUpX: e.clientX,
            clipWidthPx,
            draggedClipPct: d.fromClipPct,
            draggedIndex: siblingIndex,
            sortedClipPcts: siblingClipPcts,
          });
          if (res.kind === "click" || res.kind === "noop") {
            // "noop" is a press with enough pointer jitter to arm a drag (canDrag
            // is on for every diamond once the clip is selected) that resolved
            // back onto ~the same position — no real retime, so treat it as the
            // click it was. Otherwise a normal click with a few px of mouse/
            // trackpad drift silently does nothing: no selection, no move.
            if (e.shiftKey) onShiftClickKeyframe?.(target);
            else onClickKeyframe?.(target);
          } else if (res.kind === "move" && res.toClipPct != null) {
            const animKfs =
              target.animationId === undefined
                ? keyframesData.keyframes
                : keyframesData.keyframes.filter((k) => k.animationId === target.animationId);
            // Clamp to the mapped tween range: clipToTweenPercentage extrapolates
            // linearly, so a boundary drag past the range would otherwise reselect
            // an out-of-range tween % (e.g. 150%) even though the mutation clamps
            // the moved endpoint back to the boundary.
            const tweenPcts = animKfs
              .map((k) => k.tweenPercentage)
              .filter((v): v is number => typeof v === "number");
            const clampTween = (v: number) =>
              tweenPcts.length
                ? Math.max(Math.min(...tweenPcts), Math.min(Math.max(...tweenPcts), v))
                : v;
            const newTweenPct = clampTween(clipToTweenPercentage(animKfs, res.toClipPct));
            // For a rapid second retime the diamond still renders the stale cache
            // position, so identify the FROM keyframe by the pending (already-moved)
            // position; the mutation locates the source keyframe by this identity.
            const pendingBefore = pendingRetimes.get(kfKey);
            const fromTarget = pendingBefore
              ? {
                  ...target,
                  percentage: pendingBefore.clipPct,
                  tweenPercentage: pendingBefore.tweenPct,
                }
              : target;
            const pending = { clipPct: res.toClipPct, tweenPct: newTweenPct };
            pendingRetimes.set(kfKey, pending);
            const clearPending = () => {
              if (pendingRetimes.get(kfKey) === pending) {
                pendingRetimes.delete(kfKey);
              }
            };
            // A rejected drop (the destination time is already occupied) snaps
            // the diamond back to its source position, so the pending entry AND
            // the selection have to revert with it — parking on the ghost drop
            // position strands the playhead + selection on a keyframe that does
            // not exist there.
            const revertRetime = () => {
              clearPending();
              onClickKeyframe?.(fromTarget);
            };
            void onMoveKeyframe?.(fromTarget, res.toClipPct).then((committed) => {
              if (!committed) revertRetime();
            }, revertRetime);
            // A retime still targeted this exact diamond — park/select it at its
            // new position, same as a plain click, or a drag that actually moved
            // something looks identical to one that silently did nothing. Done
            // optimistically so the gesture stays responsive; revertRetime puts
            // it back if the move is rejected.
            onClickKeyframe?.({
              ...target,
              percentage: res.toClipPct,
              tweenPercentage: newTweenPct,
            });
          }
        };

        return (
          <button
            key={`${i}-${kf.percentage}`}
            type="button"
            className="absolute"
            data-keyframe-group={groupAware ? kf.propertyGroup : undefined}
            data-keyframe-percentage={
              groupAware ? (kf.tweenPercentage ?? kf.percentage) : undefined
            }
            style={{
              left: leftPx,
              top: centerY,
              transform: "translateY(-50%)",
              width: marker.hitWidth,
              height: diamondSize,
              zIndex: isHighlighted ? 2 : 1,
              pointerEvents: "auto",
              background: "none",
              border: "none",
              cursor: canDrag ? "ew-resize" : "pointer",
              padding: 0,
              touchAction: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "visible",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={(e) => {
              // Browser/OS cancellation (or lost capture) ends the drag without a
              // pointerup, so clear the armed drag and preview or a ghost diamond
              // stays stuck at the last previewed position.
              if (dragRef.current?.kfKey !== kfKey) return;
              dragRef.current = null;
              cancelPreviewFrame();
              setPreview(null);
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, target);
            }}
            title={`${roundPct(kf.percentage)}%`}
          >
            <svg
              width={marker.visualSize}
              height={marker.visualSize}
              viewBox="0 0 10 10"
              style={{ flexShrink: 0, pointerEvents: "none" }}
            >
              {isKfSelected && (
                <path
                  d="M5 0L10 5L5 10L0 5Z"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="0.8"
                  opacity={0.5}
                />
              )}
              <path
                d="M5 1L9 5L5 9L1 5Z"
                fill={color}
                opacity={isKfSelected || atPlayhead ? 1 : 0.55}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
});

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds(
  props: TimelineClipDiamondsProps,
) {
  return (
    <TimelineDiamondLane
      {...props}
      globalEase={props.keyframesData.ease}
      onClickKeyframe={(target) => props.onClickKeyframe?.(props.elementId, target)}
      onShiftClickKeyframe={(target) => props.onShiftClickKeyframe?.(props.elementId, target)}
      onContextMenuKeyframe={(e, target) =>
        props.onContextMenuKeyframe?.(e, props.elementId, target)
      }
      onMoveKeyframe={
        props.onMoveKeyframe
          ? (target, toClipPercentage) =>
              props.onMoveKeyframe?.(props.elementId, target, toClipPercentage) ??
              Promise.resolve(false)
          : undefined
      }
      onSelectSegment={
        props.onSelectSegment
          ? (target) => props.onSelectSegment?.(props.elementId, target)
          : undefined
      }
    />
  );
});
