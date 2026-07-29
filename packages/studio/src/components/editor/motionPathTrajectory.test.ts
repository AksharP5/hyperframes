import { describe, expect, it } from "vitest";
import { buildMotionPathTrajectory, trajectorySegmentAt } from "./motionPathTrajectory";

const ARC = [
  { x: 0, y: 0 },
  { x: 300, y: -140 },
  { x: 640, y: 120 },
];

describe("buildMotionPathTrajectory", () => {
  // The whole point of the change: an arc's guide has to follow GSAP's curve.
  // A polyline through the anchors cuts the corner the element swings wide of,
  // so the drawn line disagreed with the render.
  it("draws an arc as GSAP's resolved curve, not chords through the anchors", () => {
    const curve = buildMotionPathTrajectory({
      points: ARC,
      kind: "arc",
      curviness: 1.2,
      dotCount: 8,
    });

    expect(curve.d.startsWith("M0,0 C")).toBe(true);
    // Halfway along by length, the curve bulges clear of the straight chord
    // between the anchors it passes between.
    const mid = curve.polyline[Math.floor(curve.polyline.length / 2)]!;
    expect(Math.abs(mid.y - 0)).toBeGreaterThan(1);
    // Endpoints are still exactly the anchors: dragging a node must not shift
    // where the path starts or ends.
    expect(curve.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(curve.polyline[curve.polyline.length - 1]).toEqual({ x: 640, y: 120 });
  });

  // A keyframe path IS straight between its stops, so curving it would be a lie.
  it("leaves a linear path straight", () => {
    const line = buildMotionPathTrajectory({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      kind: "linear",
      curviness: 1,
      dotCount: 4,
    });

    expect(line.d).toBe("M0,0 L100,0");
    expect(line.dots).toEqual([
      { x: 25, y: 0 },
      { x: 50, y: 0 },
      { x: 75, y: 0 },
    ]);
  });

  // The dots exist to show velocity. Under an accelerating ease they must crowd
  // the start, which is exactly what a distance-spaced dash pattern cannot do.
  it("bunches the dots where the ease makes the element slow", () => {
    const eased = buildMotionPathTrajectory({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      kind: "linear",
      curviness: 1,
      ease: "power2.in",
      dotCount: 4,
    });

    const xs = eased.dots.map((dot) => dot.x);
    expect(xs[0]!).toBeLessThan(25);
    expect(xs[0]! - 0).toBeLessThan(xs[2]! - xs[1]!);
  });

  // GSAP eases each keyframe step on its own, so one segment slowing down must
  // not drag the timing of the next.
  it("gives each linear segment its own ease", () => {
    const mixed = buildMotionPathTrajectory({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
      kind: "linear",
      curviness: 1,
      pcts: [0, 50, 100],
      segmentEases: ["power4.in", "none"],
      dotCount: 4,
    });

    // First half is heavily eased in, second half is constant speed.
    expect(mixed.dots[0]!.x).toBeLessThan(10);
    expect(mixed.dots[2]!.x).toBeCloseTo(150, 5);
  });

  // An unknown ease name must not throw or silently distort the dots.
  it("falls back to constant speed for an ease it cannot parse", () => {
    const unknown = buildMotionPathTrajectory({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      kind: "linear",
      curviness: 1,
      ease: "not-a-real-ease",
      dotCount: 2,
    });

    expect(unknown.dots).toEqual([{ x: 50, y: 0 }]);
  });

  // A single anchor has no path; the overlay still renders its node.
  it("returns an empty path below two anchors", () => {
    const single = buildMotionPathTrajectory({
      points: [{ x: 5, y: 6 }],
      kind: "arc",
      curviness: 1,
      dotCount: 8,
    });

    expect(single.d).toBe("M5,6");
    expect(single.dots).toEqual([]);
  });
});

describe("trajectorySegmentAt", () => {
  // Insertion still has to name an ANCHOR segment. Reading the sampled index
  // straight through would insert a waypoint tens of positions past the end.
  it("maps a sample on the dense curve back to the anchor segment it belongs to", () => {
    expect(trajectorySegmentAt("arc", 0, 0.5, 2)).toEqual({ segIndex: 0, t: 0.5 / 24 });
    expect(trajectorySegmentAt("arc", 24, 0, 2).segIndex).toBe(1);
    // Past the last anchor segment (the closing sample) clamps rather than
    // pointing at a segment that does not exist.
    expect(trajectorySegmentAt("arc", 48, 0, 2).segIndex).toBe(1);
  });

  it("passes a linear hit straight through", () => {
    expect(trajectorySegmentAt("linear", 3, 0.25, 5)).toEqual({ segIndex: 3, t: 0.25 });
  });
});
