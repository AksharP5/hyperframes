/**
 * The "can't be moved from the timeline yet" toast, rate-limited.
 *
 * Its own hook so `useTimelineEditing.ts` stays under the studio's 600-line cap.
 * The 1.5s gate matters: a blocked drag fires this per pointermove, and without
 * it one gesture stacked dozens of identical toasts.
 */

import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import {
  MAX_HAND_EDIT_CLIPS,
  type BlockedTimelineEditIntent,
} from "../player/components/timelineEditing";

const BLOCKED_TOAST_INTERVAL_MS = 1500;

export function useBlockedTimelineEditToast(
  showToast: (message: string, tone?: "info" | "error") => void,
): (element: TimelineElement, intent: BlockedTimelineEditIntent) => void {
  const lastAtRef = useRef(0);
  return useCallback(
    (_element: TimelineElement, intent: BlockedTimelineEditIntent) => {
      const now = Date.now();
      if (now - lastAtRef.current < BLOCKED_TOAST_INTERVAL_MS) return;
      lastAtRef.current = now;
      showToast(
        intent === "edit-many"
          ? `Select ${MAX_HAND_EDIT_CLIPS} or fewer clips to move or resize by hand, or describe the change.`
          : "This clip can't be moved or resized from the timeline yet.",
        "info",
      );
    },
    [showToast],
  );
}
