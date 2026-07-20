import { useMemo } from "react";
import { STUDIO_PREVIEW_FPS } from "../lib/time";
import type { TimelineTimeDisplayMode } from "../../utils/studioUiPreferences";
import { generateTicks } from "./timelineRulerGeometry";

export function useTimelineTicks(
  duration: number,
  pixelsPerSecond: number,
  timeDisplayMode: TimelineTimeDisplayMode,
): { major: number[]; minor: number[] } {
  const frameRate = timeDisplayMode === "frame" ? STUDIO_PREVIEW_FPS : undefined;
  const { major, minor } = useMemo(
    () => generateTicks(duration, pixelsPerSecond, frameRate),
    [duration, frameRate, pixelsPerSecond],
  );
  return { major, minor };
}
