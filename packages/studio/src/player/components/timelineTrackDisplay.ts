/**
 * The one owner of "what track number does the user see".
 *
 * `TimelineElement.track` is a z-order SORT key, not a row number: an expanded
 * sub-composition child gets a synthesized fractional key (`host.track + n /
 * (siblings + 2)`, see `useExpandedTimelineElements`), so putting it in a string
 * announces "Hide track 0.16666666666666666". Every user-visible track number,
 * whether it is rendered by a component or baked into an undo-history label,
 * routes through here; the raw key stays in callbacks and lookups only.
 */

/** Ascending distinct track keys, the row order the timeline renders in. */
export function timelineTrackOrder(elements: readonly { track: number }[]): number[] {
  return [...new Set(elements.map((element) => element.track))].sort((a, b) => a - b);
}

/**
 * A track key's 1-based display row. A key not in `trackOrder` (a drag preview
 * onto a brand-new track, say) reads as the row it would land on at the end.
 */
export function trackDisplayNumber(trackOrder: readonly number[], track: number): number {
  const row = trackOrder.indexOf(track);
  return row < 0 ? trackOrder.length + 1 : row + 1;
}
