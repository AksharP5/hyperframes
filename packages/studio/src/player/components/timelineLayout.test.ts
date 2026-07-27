import { describe, it, expect } from "vitest";
import {
  RULER_H,
  TRACK_H,
  TRACKS_TOP_PAD,
  TRACKS_BOTTOM_PAD,
  GUTTER,
  TRACKS_LEFT_PAD,
  getTimelineRowTop,
  getTimelineScrubTime,
  getTimelineRowFromY,
  getTimelineCanvasHeight,
  resolveTimelineAssetDrop,
} from "./timelineLayout";

describe("track-area breathing pad y-math", () => {
  describe("getTimelineRowTop", () => {
    it("offsets the first lane below the ruler by the top pad", () => {
      expect(getTimelineRowTop(0)).toBe(RULER_H + TRACKS_TOP_PAD);
    });

    it("advances by one track height per row, keeping the pad", () => {
      expect(getTimelineRowTop(1)).toBe(RULER_H + TRACKS_TOP_PAD + TRACK_H);
      expect(getTimelineRowTop(3)).toBe(RULER_H + TRACKS_TOP_PAD + 3 * TRACK_H);
    });

    it("is a strict positive shift from the pre-pad formula (pad is non-zero)", () => {
      expect(TRACKS_TOP_PAD).toBeGreaterThan(0);
      expect(getTimelineRowTop(2)).toBe(RULER_H + 2 * TRACK_H + TRACKS_TOP_PAD);
    });
  });

  describe("getTimelineRowFromY", () => {
    it("is the exact inverse of getTimelineRowTop at lane boundaries", () => {
      for (const row of [0, 1, 2, 7]) {
        expect(getTimelineRowFromY(getTimelineRowTop(row))).toBeCloseTo(row, 10);
      }
    });

    it("floors a y inside the top pad (above lane 0) to a negative fraction", () => {
      // A drop in the pad between the ruler and lane 0 sits at row < 0, so a
      // floor lands it on row -1 → getDefaultDroppedTrack floors to the top lane.
      const yInPad = RULER_H + TRACKS_TOP_PAD / 2;
      expect(getTimelineRowFromY(yInPad)).toBeLessThan(0);
    });

    it("maps a y in the middle of lane 1 into [1,2)", () => {
      const yMidLane1 = getTimelineRowTop(1) + TRACK_H / 2;
      const row = getTimelineRowFromY(yMidLane1);
      expect(row).toBeGreaterThanOrEqual(1);
      expect(row).toBeLessThan(2);
    });
  });

  describe("getTimelineCanvasHeight", () => {
    it("reserves ruler + top pad + lanes + bottom pad", () => {
      expect(getTimelineCanvasHeight(0)).toBe(RULER_H + TRACKS_TOP_PAD + TRACKS_BOTTOM_PAD);
      expect(getTimelineCanvasHeight(3)).toBe(
        RULER_H + TRACKS_TOP_PAD + 3 * TRACK_H + TRACKS_BOTTOM_PAD,
      );
    });

    it("clamps a negative track count to zero lanes", () => {
      expect(getTimelineCanvasHeight(-4)).toBe(RULER_H + TRACKS_TOP_PAD + TRACKS_BOTTOM_PAD);
    });

    it("leaves room below the last lane for a drag-into-void new track", () => {
      // The gap below the final lane must be at least a full track height so a
      // clip can be dropped there to create a new bottom track.
      const oneLane = getTimelineCanvasHeight(1);
      const lastLaneBottom = getTimelineRowTop(0) + TRACK_H;
      expect(oneLane - lastLaneBottom).toBeGreaterThanOrEqual(TRACK_H);
    });
  });

  describe("resolveTimelineAssetDrop honours the top pad", () => {
    const base = {
      rectLeft: 0,
      rectTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      pixelsPerSecond: 100,
      duration: 60,
      trackHeight: TRACK_H,
      trackOrder: [0, 1, 2],
    };

    it("drops onto lane 0 when the pointer is in the middle of the first lane", () => {
      const clientY = getTimelineRowTop(0) + TRACK_H / 2;
      const clientX = GUTTER + TRACKS_LEFT_PAD + 100; // t = 1s
      const { start, track } = resolveTimelineAssetDrop(base, clientX, clientY);
      expect(track).toBe(0);
      expect(start).toBe(1);
    });

    it("drops into the top pad → floors to the first lane (row < 0)", () => {
      const clientY = RULER_H + TRACKS_TOP_PAD / 2; // inside the pad, above lane 0
      const { track } = resolveTimelineAssetDrop(base, GUTTER, clientY);
      expect(track).toBe(0);
    });

    it("drops below the last lane → appends a new track", () => {
      const clientY = getTimelineRowTop(2) + TRACK_H + 4; // in the bottom pad
      const { track } = resolveTimelineAssetDrop(base, GUTTER, clientY);
      expect(track).toBe(3); // max(trackOrder)+1
    });
  });
});

describe("getTimelineScrubTime", () => {
  const at = (clientX: number, duration = 10) =>
    getTimelineScrubTime({
      clientX,
      viewportLeft: 0,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      duration,
    });
  const origin = GUTTER + TRACKS_LEFT_PAD;

  it("maps the content origin to t=0", () => {
    expect(at(origin)).toBe(0);
    expect(at(origin + 250)).toBe(2.5);
  });

  // The bug: a pointer left of the origin used to abort the scrub instead of
  // clamping, so dragging the playhead to the start only worked if a sample
  // happened to land in the few px before t=0.
  it("clamps a pointer left of the origin to 0 instead of dropping the scrub", () => {
    expect(at(origin - 1)).toBe(0);
    expect(at(origin - 500)).toBe(0);
    expect(at(0)).toBe(0);
  });

  it("clamps past the end to the duration", () => {
    expect(at(origin + 5000)).toBe(10);
  });

  it("returns 0 for a degenerate zoom or duration", () => {
    expect(
      getTimelineScrubTime({
        clientX: 500,
        viewportLeft: 0,
        scrollLeft: 0,
        pixelsPerSecond: 0,
        duration: 10,
      }),
    ).toBe(0);
    expect(at(origin + 250, Number.NaN)).toBe(0);
  });
});
