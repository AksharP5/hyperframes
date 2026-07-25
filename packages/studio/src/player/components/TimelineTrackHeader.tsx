import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import { Music } from "../../icons/SystemIcons";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { getTimelinePropertyLanes } from "./TimelinePropertyLanes";
import { LayerDisclosureRow } from "./LayerDisclosureRow";
import { TrackClipCount } from "./TrackClipCount";
import { LABEL_COL_W, LANE_H, getTimelineLaneTop } from "./timelineLayout";
import type { TimelineTheme } from "./timelineTheme";
import {
  resolveLaneHeaderState,
  type KeyframeNavigationState,
  type TimelinePropertyLane,
} from "./trackHeaderLaneState";
import { valueReadout } from "./trackHeaderLaneValues";

interface TimelineTrackHeaderProps {
  trackNumber: number;
  trackLabel: string;
  contentOrigin: number;
  /** The track's active keyframe clip (selected, else primary) — the one whose
   *  disclosure + property rows this header shows, whether expanded or not. */
  keyframeClip: TimelineElement | null;
  /** Clips on this track, so the header can say how many the row holds. */
  clipCount: number;
  isExpanded: boolean;
  animations: readonly GsapAnimation[];
  currentTime: number;
  isTrackHidden: boolean;
  isAudioTrack: boolean;
  isActive: boolean;
  isHovered: boolean;
  theme: TimelineTheme;
  onToggleClipExpanded: () => void;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onSeek?: (time: number) => void;
}

function VisibilityButton({
  hidden,
  trackNumber,
  visible,
  onToggle,
}: {
  hidden: boolean;
  trackNumber: number;
  visible: boolean;
  onToggle: TimelineEditCallbacks["onToggleTrackHidden"];
}) {
  if (!visible) return <span aria-hidden="true" className="h-6 w-6 shrink-0" />;
  const label = hidden ? `Show track ${trackNumber}` : `Hide track ${trackNumber}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-[#3CE6AC] ${
        hidden ? "text-[#3CE6AC] hover:text-white" : "text-white/35 hover:text-white/75"
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void onToggle?.(trackNumber, !hidden);
      }}
    >
      {hidden ? (
        <EyeSlash size={14} weight="bold" aria-hidden="true" />
      ) : (
        <Eye size={14} weight="bold" aria-hidden="true" />
      )}
    </button>
  );
}

function LegacyTrackHeader({
  trackNumber,
  trackLabel,
  clipCount,
  showTrackLabel,
  isTrackHidden,
  isAudioTrack,
  onToggleTrackHidden,
}: Pick<
  TimelineTrackHeaderProps,
  | "trackNumber"
  | "trackLabel"
  | "clipCount"
  | "isTrackHidden"
  | "isAudioTrack"
  | "onToggleTrackHidden"
> & { showTrackLabel: boolean }) {
  return (
    <>
      {isAudioTrack && (
        <Music size={12} weight="fill" aria-hidden="true" className="text-white/35" />
      )}
      {showTrackLabel && (
        <span className="min-w-0 flex-1 truncate text-[11px]" title={trackLabel}>
          {trackLabel}
        </span>
      )}
      {showTrackLabel && <TrackClipCount clipCount={clipCount} />}
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        visible
        onToggle={onToggleTrackHidden}
      />
    </>
  );
}

// Figma layout: prev-keyframe ‹, the add/remove toggle (children), next ›.
function PropertyGroupNavigation({
  navigation,
  label,
  expandedElement,
  onSeek,
  children,
}: {
  navigation: KeyframeNavigationState;
  label: string;
  expandedElement: TimelineElement;
  onSeek?: (time: number) => void;
  children: React.ReactNode;
}) {
  const seekTo = (keyframe: { percentage: number } | null) => {
    if (keyframe) {
      onSeek?.(expandedElement.start + (keyframe.percentage / 100) * expandedElement.duration);
    }
  };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label={`Previous ${label} keyframe`}
        disabled={!navigation.prevKeyframe}
        className="h-5 w-3 border-0 bg-transparent p-0 text-white/55 hover:text-white disabled:text-white/15"
        onClick={(event) => {
          event.stopPropagation();
          seekTo(navigation.prevKeyframe);
        }}
      >
        ‹
      </button>
      {children}
      <button
        type="button"
        aria-label={`Next ${label} keyframe`}
        disabled={!navigation.nextKeyframe}
        className="h-5 w-3 border-0 bg-transparent p-0 text-white/55 hover:text-white disabled:text-white/15"
        onClick={(event) => {
          event.stopPropagation();
          seekTo(navigation.nextKeyframe);
        }}
      >
        ›
      </button>
    </span>
  );
}

function PropertyGroupHeaderRow({
  lane,
  laneIndex,
  isLastLane,
  expandedElement,
  currentTime,
  clipPercentage,
  hoveredGroup,
  setHoveredGroup,
  isActive,
  isHovered,
  isTrackHidden,
  trackNumber,
  gutterBackground,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onSeek,
}: {
  lane: TimelinePropertyLane;
  laneIndex: number;
  isLastLane: boolean;
  expandedElement: TimelineElement;
  currentTime: number;
  clipPercentage: number;
  hoveredGroup: PropertyGroupName | null;
  setHoveredGroup: (group: PropertyGroupName | null) => void;
  isActive: boolean;
  isHovered: boolean;
  isTrackHidden: boolean;
  trackNumber: number;
  gutterBackground: string;
  onToggleTrackHidden: TimelineEditCallbacks["onToggleTrackHidden"];
  onTogglePropertyGroupKeyframe?: TimelineEditCallbacks["onTogglePropertyGroupKeyframe"];
  onSeek?: (time: number) => void;
}) {
  const { navigation, values, label, toggleTarget } = resolveLaneHeaderState(
    lane,
    currentTime,
    clipPercentage,
  );
  const showEye =
    hoveredGroup === lane.group ||
    (hoveredGroup === null && laneIndex === 0 && (isActive || isHovered));

  return (
    <div
      data-property-group={lane.group}
      data-timeline-lane-top={getTimelineLaneTop(laneIndex)}
      className="absolute left-0 flex items-center gap-1 px-1.5 text-[10px] text-white/65"
      style={{
        top: getTimelineLaneTop(laneIndex),
        width: LABEL_COL_W,
        height: LANE_H,
        background: gutterBackground,
      }}
      onPointerEnter={() => setHoveredGroup(lane.group)}
      onPointerLeave={() => setHoveredGroup(null)}
    >
      {/* Tree connector: vertical spine (top-half on the last lane) + branch tick. */}
      <span className="relative h-full w-3 shrink-0" aria-hidden="true">
        <span
          className="absolute left-1.5 top-0 w-px bg-white/15"
          style={{ height: isLastLane ? "50%" : "100%" }}
        />
        <span className="absolute left-1.5 top-1/2 h-px w-1.5 bg-white/15" />
      </span>
      <span className="w-[46px] shrink-0 truncate text-white" title={label}>
        {label}
      </span>
      <PropertyGroupNavigation
        navigation={navigation}
        label={label}
        expandedElement={expandedElement}
        onSeek={onSeek}
      >
        <button
          type="button"
          aria-label={`Toggle ${label} keyframe`}
          title={`${navigation.currentKeyframe ? "Remove" : "Add"} ${label} keyframe`}
          className="flex h-5 w-4 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-[11px] text-[#3CE6AC] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#3CE6AC]"
          onClick={(event) => {
            // Same as the disclosure caret and the eye: a control in the label
            // column owns its click, it does not also hit the track row behind it.
            event.stopPropagation();
            if (expandedElement && toggleTarget) {
              void onTogglePropertyGroupKeyframe?.(expandedElement, toggleTarget);
            }
          }}
        >
          {navigation.currentKeyframe ? "◆" : "◇"}
        </button>
      </PropertyGroupNavigation>
      <span
        className="min-w-0 flex-1 truncate text-right tabular-nums text-white/45"
        title={valueReadout(lane.group, values)}
      >
        {valueReadout(lane.group, values)}
      </span>
      <VisibilityButton
        hidden={isTrackHidden}
        trackNumber={trackNumber}
        visible={showEye}
        onToggle={onToggleTrackHidden}
      />
    </div>
  );
}

export function TimelineTrackHeader({
  trackNumber,
  trackLabel,
  contentOrigin,
  keyframeClip,
  clipCount,
  isExpanded,
  animations,
  currentTime,
  isTrackHidden,
  isAudioTrack,
  isActive,
  isHovered,
  theme,
  onToggleClipExpanded,
  onToggleTrackHidden,
  onTogglePropertyGroupKeyframe,
  onSeek,
}: TimelineTrackHeaderProps) {
  const [hoveredGroup, setHoveredGroup] = useState<PropertyGroupName | null>(null);
  const clipPercentage = keyframeClip
    ? ((currentTime - keyframeClip.start) / keyframeClip.duration) * 100
    : 0;
  const lanes = keyframeClip
    ? getTimelinePropertyLanes(animations, keyframeClip.start, keyframeClip.duration)
    : [];
  // Label mode = keyframe view; the label column stays LABEL_COL_W (Timeline.tsx
  // owns the gutter past it, so a 0% diamond isn't clipped by this panel).
  const showTrackLabel = contentOrigin >= LABEL_COL_W;
  const isKeyframeLayer = !!keyframeClip && lanes.length > 0;

  return (
    <div
      className={`sticky left-0 z-[12] shrink-0 ${
        !isKeyframeLayer
          ? showTrackLabel
            ? "flex items-center gap-1 px-1.5 text-white/55"
            : "flex flex-col items-center justify-center gap-0.5"
          : ""
      }`}
      style={{
        width: showTrackLabel ? LABEL_COL_W : contentOrigin,
        background: theme.gutterBackground,
        borderRight: `1px solid ${theme.gutterBorder}`,
      }}
    >
      {!keyframeClip || lanes.length === 0 ? (
        <LegacyTrackHeader
          trackNumber={trackNumber}
          trackLabel={trackLabel}
          clipCount={clipCount}
          showTrackLabel={showTrackLabel}
          isTrackHidden={isTrackHidden}
          isAudioTrack={isAudioTrack}
          onToggleTrackHidden={onToggleTrackHidden}
        />
      ) : (
        <>
          <LayerDisclosureRow
            keyframeClip={keyframeClip}
            clipCount={clipCount}
            isExpanded={isExpanded}
            gutterBackground={theme.gutterBackground}
            onToggleClipExpanded={onToggleClipExpanded}
          />
          {isExpanded &&
            lanes.map((lane, laneIndex) => (
              <PropertyGroupHeaderRow
                key={lane.group}
                lane={lane}
                laneIndex={laneIndex}
                isLastLane={laneIndex === lanes.length - 1}
                expandedElement={keyframeClip}
                currentTime={currentTime}
                clipPercentage={clipPercentage}
                hoveredGroup={hoveredGroup}
                setHoveredGroup={setHoveredGroup}
                isActive={isActive}
                isHovered={isHovered}
                isTrackHidden={isTrackHidden}
                trackNumber={trackNumber}
                gutterBackground={theme.gutterBackground}
                onToggleTrackHidden={onToggleTrackHidden}
                onTogglePropertyGroupKeyframe={onTogglePropertyGroupKeyframe}
                onSeek={onSeek}
              />
            ))}
        </>
      )}
    </div>
  );
}
