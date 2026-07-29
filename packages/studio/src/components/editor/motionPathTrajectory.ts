/**
 * The trajectory an element actually travels, plus where it sits at equal steps
 * of time along it. The overlay used to draw straight chords between its nodes.
 * That is the real motion for an x/y keyframe tween, but a motionPath curves
 * between its anchors, so on an arc the guide disagreed with the render: the
 * dashed line cut across corners the element swung wide of.
 *
 * The curve comes from GSAP's own MotionPathPlugin math rather than a lookalike
 * spline, so the guide and the render cannot drift apart.
 *
 * Pure - no React, no DOM - so it unit-tests in isolation. Coordinates are in
 * whatever space the caller passes (the overlay uses composition space).
 */
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import type { GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import type { MotionNodeRef } from "./motionPathGeometry";

export interface TrajectoryPoint {
  x: number;
  y: number;
}

/**
 * How finely a curved segment is broken into straight pieces for hit testing.
 * Only the add-a-node ghost reads the polyline, and it snaps to the nearest
 * point, so this trades a longer array against how far the ghost can sit from
 * the drawn curve. At 24 a full-canvas segment stays inside a pixel or two.
 */
const SAMPLES_PER_SEGMENT = 24;

export interface MotionPathTrajectory {
  /** SVG path data for the drawn guide. */
  d: string;
  /**
   * The same curve as a dense polyline. Hit testing runs against this, so the
   * ghost lands on the line the author can see rather than on a chord behind it.
   */
  polyline: TrajectoryPoint[];
  /** Positions at equal steps of time. Bunching means the element is slow there. */
  dots: TrajectoryPoint[];
}

export interface TrajectoryInput {
  /** Path anchors, in path order. */
  points: readonly TrajectoryPoint[];
  /** "linear" = x/y keyframes (straight between anchors); "arc" = motionPath. */
  kind: "linear" | "arc";
  /** motionPath curviness. Ignored for a linear path. */
  curviness: number;
  /**
   * Tween-relative % of each anchor, used to give each linear segment its share
   * of the timing dots. Anchors are treated as evenly spaced when absent.
   */
  pcts?: readonly number[];
  /** Ease over the whole tween (an arc), or the fallback for a linear segment. */
  ease?: string;
  /**
   * Per-segment ease for a linear path: index i governs points[i] to
   * points[i + 1]. A `keyframes` array eases every step on its own, so a single
   * tween ease is the wrong shape here.
   */
  segmentEases?: readonly (string | undefined)[];
  /** How many equal-time samples to place along the path. */
  dotCount: number;
}

/** GSAP's own parser, falling back to constant speed for an ease we cannot name. */
function easeFn(ease: string | undefined): (progress: number) => number {
  if (!ease) return (progress) => progress;
  const parsed = gsap.parseEase(ease);
  return typeof parsed === "function" ? parsed : (progress) => progress;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Break an arc into a dense polyline through GSAP's resolved curve. Every anchor
 * stays a sample boundary, so a sample index still maps back onto the segment
 * that owns it (see `trajectorySegmentAt`).
 */
function sampleArc(
  points: readonly TrajectoryPoint[],
  curviness: number,
): {
  d: string;
  polyline: TrajectoryPoint[];
} {
  const rawPath = MotionPathPlugin.arrayToRawPath(
    points.map((point) => ({ x: point.x, y: point.y })),
    { curviness },
  );
  const cubic = rawPath[0];
  const polyline: TrajectoryPoint[] = [];
  // One cubic per segment: 6 numbers per segment after the leading move point.
  const segments = cubic ? (cubic.length - 2) / 6 : 0;
  for (let segment = 0; segment < segments; segment++) {
    const base = segment * 6;
    const x0 = cubic![base]!;
    const y0 = cubic![base + 1]!;
    const x1 = cubic![base + 2]!;
    const y1 = cubic![base + 3]!;
    const x2 = cubic![base + 4]!;
    const y2 = cubic![base + 5]!;
    const x3 = cubic![base + 6]!;
    const y3 = cubic![base + 7]!;
    for (let step = 0; step < SAMPLES_PER_SEGMENT; step++) {
      const t = step / SAMPLES_PER_SEGMENT;
      const u = 1 - t;
      polyline.push({
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      });
    }
  }
  const last = points[points.length - 1];
  if (last) polyline.push({ x: last.x, y: last.y });
  return { d: MotionPathPlugin.rawPathToString(rawPath), polyline };
}

/** Point at `progress` (0..1) of the way along a polyline, by straight-line length. */
function pointAtLength(polyline: readonly TrajectoryPoint[], progress: number): TrajectoryPoint {
  const first = polyline[0]!;
  if (polyline.length < 2) return { x: first.x, y: first.y };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += Math.hypot(polyline[i]!.x - polyline[i - 1]!.x, polyline[i]!.y - polyline[i - 1]!.y);
    lengths.push(total);
  }
  if (total === 0) return { x: first.x, y: first.y };
  const wanted = Math.max(0, Math.min(1, progress)) * total;
  let index = lengths.findIndex((length) => length >= wanted);
  if (index < 0) index = lengths.length - 1;
  const before = index === 0 ? 0 : lengths[index - 1]!;
  const span = lengths[index]! - before;
  const t = span === 0 ? 0 : (wanted - before) / span;
  const a = polyline[index]!;
  const b = polyline[index + 1]!;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Where the element is at tween-relative time `t` (0..1) on a linear path. */
function linearPointAtTime(input: TrajectoryInput, t: number): TrajectoryPoint {
  const { points, pcts, ease, segmentEases } = input;
  const stops =
    pcts && pcts.length === points.length
      ? pcts
      : points.map((_, index) => (index / (points.length - 1)) * 100);
  const pct = t * 100;
  let segment = 0;
  while (segment < stops.length - 2 && pct > stops[segment + 1]!) segment++;
  const from = stops[segment]!;
  const to = stops[segment + 1]!;
  const local = to === from ? 0 : Math.max(0, Math.min(1, (pct - from) / (to - from)));
  const a = points[segment]!;
  const b = points[segment + 1]!;
  // GSAP eases each keyframe step on its own, so the segment's ease wins over
  // the tween's whenever the source authored one.
  const eased = easeFn(segmentEases?.[segment] ?? ease)(local);
  return { x: lerp(a.x, b.x, eased), y: lerp(a.y, b.y, eased) };
}

export function buildMotionPathTrajectory(input: TrajectoryInput): MotionPathTrajectory {
  const { points, kind, curviness, ease, dotCount } = input;
  if (points.length < 2) {
    const only = points[0];
    return {
      d: only ? `M${only.x},${only.y}` : "",
      polyline: only ? [{ x: only.x, y: only.y }] : [],
      dots: [],
    };
  }

  const arc = kind === "arc";
  const shape = arc
    ? sampleArc(points, curviness)
    : {
        d: points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" "),
        polyline: points.map((p) => ({ x: p.x, y: p.y })),
      };

  // Interior samples only: a dot on an anchor is hidden by the node drawn there
  // and says nothing the anchor does not already say.
  const dots: TrajectoryPoint[] = [];
  const arcEase = easeFn(ease);
  for (let step = 1; step < dotCount; step++) {
    const t = step / dotCount;
    // One tween-level ease owns every segment of an arc, and motionPath spreads
    // progress along the whole curve by length, so the two paths differ.
    dots.push(arc ? pointAtLength(shape.polyline, arcEase(t)) : linearPointAtTime(input, t));
  }

  return { ...shape, dots };
}

/** A drawn anchor: absolute position plus the source edit it maps to. */
interface AnchorNode {
  ax: number;
  ay: number;
  ref: MotionNodeRef;
}

/**
 * Build the trajectory for a live tween. Reads the shape between anchors and the
 * timing that spaces the dots off the parsed animation, so the overlay only has
 * to hand over the anchors it already drew.
 *
 * `kind` comes back because a cubic arc falls back to straight chords: its
 * anchors carry their own control points, which one curviness value cannot
 * reproduce, and drawing an approximation would be a guide to a path that is not
 * the one being rendered.
 */
export function buildTweenTrajectory(
  anim: GsapAnimation | undefined,
  kind: "linear" | "arc",
  anchors: readonly AnchorNode[],
  dotCount: number,
): MotionPathTrajectory & { kind: "linear" | "arc" } {
  const segments = anim?.arcPath?.segments;
  const cubic = segments?.some((segment) => segment.cp1 || segment.cp2) ?? false;
  const drawnKind = kind === "arc" && !cubic ? "arc" : "linear";
  const sourceKeyframes = anim?.keyframes?.keyframes;
  const easeAt = (ref: MotionNodeRef) =>
    ref.type === "keyframe"
      ? sourceKeyframes?.find((keyframe) => keyframe.percentage === ref.pct)?.ease
      : undefined;

  return {
    kind: drawnKind,
    ...buildMotionPathTrajectory({
      points: anchors.map((anchor) => ({ x: anchor.ax, y: anchor.ay })),
      kind: drawnKind,
      curviness: segments?.[0]?.curviness ?? 1,
      pcts: anchors.map((anchor, i) =>
        anchor.ref.type === "keyframe" ? anchor.ref.pct : (i / (anchors.length - 1)) * 100,
      ),
      ease: anim?.keyframes?.easeEach ?? anim?.keyframes?.ease ?? anim?.ease,
      // A keyframe's own ease governs the step arriving AT it, so segment i takes
      // the ease authored on the node that closes it.
      segmentEases: anchors.slice(1).map((anchor) => easeAt(anchor.ref)),
      dotCount,
    }),
  };
}

/**
 * Tween-% for a stop inserted at fraction `t` along the segment between two
 * nodes. null when either end is not a keyframe (arc waypoints carry no %).
 */
export function interpolatedKeyframePct(
  a: MotionNodeRef | undefined,
  b: MotionNodeRef | undefined,
  t: number,
): number | null {
  if (a?.type !== "keyframe" || b?.type !== "keyframe") return null;
  return Math.round((a.pct + (b.pct - a.pct) * t) * 1000) / 1000;
}

/**
 * Map a hit on the dense polyline back onto the anchor segment that owns it.
 * `index`/`t` come straight from `nearestPointOnPath` run over `polyline`.
 */
export function trajectorySegmentAt(
  kind: "linear" | "arc",
  index: number,
  t: number,
  segmentCount: number,
): { segIndex: number; t: number } {
  if (kind !== "arc") return { segIndex: index, t };
  const along = (index + t) / SAMPLES_PER_SEGMENT;
  const segIndex = Math.min(Math.floor(along), Math.max(0, segmentCount - 1));
  return { segIndex, t: along - segIndex };
}
