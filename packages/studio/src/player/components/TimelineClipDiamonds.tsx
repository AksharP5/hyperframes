import { Fragment, memo, useEffect, useRef, useState } from "react";
import { BEAT_BAND_H } from "./BeatStrip";
import {
  KEYFRAME_DRAG_THRESHOLD_PX,
  previewClipPct,
  resolveKeyframeDrag,
} from "../../components/editor/keyframeDrag";
import { MiniCurveSvg } from "../../components/editor/EaseCurveSection";
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
  type TimelineDiamondLaneProps,
} from "./timelineDiamondTypes";

export type { TimelineDiamondKeyframe } from "./timelineDiamondTypes";

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
  const pendingRetimeRef = useRef(new Map<string, { clipPct: number; tweenPct: number }>());
  useEffect(() => {
    // Clear a pending entry once the authoritative cache reflects a keyframe at
    // ~its destination. Match by tolerance, not equality: cache writers round
    // clip %s, so an exact check would leak an entry after every successful retime.
    for (const [key, pending] of pendingRetimeRef.current) {
      if (keyframesData.keyframes.some((k) => Math.abs(k.percentage - pending.clipPct) < 0.2)) {
        pendingRetimeRef.current.delete(key);
      }
    }
  }, [keyframesData.keyframes]);
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
  // Clip-%s of the sorted keyframes — the neighbour clamp (preview + drop) needs
  // the whole row to bound the dragged diamond between its immediate siblings.
  const sortedClipPcts = sorted.map((k) => k.percentage);
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
    const hitWidth = Math.min(diamondSize, nearestGap);
    return {
      keyframe,
      centerX,
      hitWidth,
      visualSize: hitWidth === diamondSize ? diamondSize : Math.max(2, hitWidth - 2),
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
      {markers.map((marker, i) => {
        const previous = markers[i - 1];
        if (!previous) return null;
        const kf = marker.keyframe;
        const x1 = previous.centerX;
        const x2 = marker.centerX;
        if (x2 - x1 < 1) return null;
        const connectorLeft = x1 + previous.visualSize / 2;
        const connectorWidth = x2 - x1 - previous.visualSize / 2 - marker.visualSize / 2;
        // The ease button targets one segment, so it needs the keyframe's own
        // animationId/tweenPercentage. On a merged inline row the button is
        // hidden where the segment is ambiguous (two source animations collide
        // at this % with different eases; see easeAmbiguous) or the keyframe has
        // no source animation id (runtime-scanned) so there is no tween to target.
        const target = keyframeTarget(kf);
        const ease = kf.ease ?? globalEase;
        return (
          <Fragment key={`line-${i}-${previous.keyframe.percentage}-${kf.percentage}`}>
            <div
              className="absolute"
              data-keyframe-connector={groupAware ? "" : undefined}
              style={{
                left: connectorLeft,
                top: centerY,
                width: Math.max(0, connectorWidth),
                height: 2,
                transform: "translateY(-1px)",
                background: baseColor,
                opacity: baseOpacity,
                borderRadius: 1,
              }}
            />
            {onSelectSegment && !kf.easeAmbiguous && kf.animationId !== undefined && (
              <div
                className="group absolute"
                data-keyframe-ease-segment=""
                style={{
                  left: x1,
                  top: centerY,
                  width: x2 - x1,
                  height: 18,
                  transform: "translateY(-50%)",
                  // Own a stacking context above the diamond buttons. At fit
                  // zoom the 16px ease control can overlap its neighbouring
                  // diamond; without a z-index here the later diamond wins the
                  // hit test even though the child button has z-index 3.
                  zIndex: 3,
                  // Only the centered control is interactive. The transparent
                  // segment wrapper must not swallow connector/clip gestures.
                  pointerEvents: "none",
                }}
              >
                <button
                  type="button"
                  data-keyframe-ease-button=""
                  aria-label={`Edit ${ease} easing`}
                  title={`Edit ${ease} easing`}
                  className="absolute flex items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  style={{
                    left: "50%",
                    top: "50%",
                    width: 16,
                    height: 16,
                    transform: "translate(-50%, -50%)",
                    zIndex: 3,
                    pointerEvents: "auto",
                    padding: 0,
                    border: "1px solid rgba(255, 255, 255, 0.14)",
                    background: "#171717",
                    cursor: "pointer",
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSegment(target);
                  }}
                >
                  <MiniCurveSvg ease={ease} active size={12} />
                </button>
              </div>
            )}
          </Fragment>
        );
      })}

      {markers.map((marker, i) => {
        const kf = marker.keyframe;
        const target = keyframeTarget(kf);
        const kfKey = timelineKeyframeSelectionKey(elementId, target);
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
              index: i,
              fromClipPct: pendingRetimeRef.current.get(kfKey)?.clipPct ?? kf.percentage,
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
                sortedClipPcts,
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
            draggedIndex: i,
            sortedClipPcts,
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
            const pendingBefore = pendingRetimeRef.current.get(kfKey);
            const fromTarget = pendingBefore
              ? {
                  ...target,
                  percentage: pendingBefore.clipPct,
                  tweenPercentage: pendingBefore.tweenPct,
                }
              : target;
            const pending = { clipPct: res.toClipPct, tweenPct: newTweenPct };
            pendingRetimeRef.current.set(kfKey, pending);
            const clearPending = () => {
              if (pendingRetimeRef.current.get(kfKey) === pending) {
                pendingRetimeRef.current.delete(kfKey);
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
            title={`${kf.percentage}%`}
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
