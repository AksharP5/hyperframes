/**
 * Which elements to blur: the ones that move fast enough for a smear to show.
 *
 * One scan: candidates are elements whose inline style changes or that a CSS / WAAPI animation
 * moves; they must reach MIN_SPEED px/frame outside any 3D context (the redraw is 2D), and only
 * the outermost of nested candidates is kept.
 */

import { isHtmlElement } from "../domRealm";

/** Under this peak speed (px per frame) a smear is invisible, so the element stays sharp. */
const MIN_SPEED = 2;

/** Scan resolution: at most this many timeline samples, however long the composition. */
const SCAN_STEPS = 240;

const ANIMATED_POSE_PROPS = new Set<string>([
  "transform",
  "translate",
  "rotate",
  "scale",
  "left",
  "top",
  "right",
  "bottom",
]);

export interface DiscoverOptions {
  scene: HTMLElement;
  durationSeconds: number;
  fps: number;
  /** Seek the composition (timeline + adapters) to a time. */
  seek: (t: number) => void;
}

export interface Discovery {
  movers: HTMLElement[];
  /** Every element whose pose changes at all; their transforms are never cached. */
  dynamic: Set<Element>;
}

// The whole inline style in one read; opacity or colour tweens only cost a rect check.
const styleKey = (el: HTMLElement): string => el.getAttribute("style") ?? "";

function optedOut(el: Element, scene: Element): boolean {
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    if (n.getAttribute("data-motion-blur") === "off") return true;
  }
  return false;
}

function in3d(el: Element, scene: Element): boolean {
  for (let n: Element | null = el; n && n !== scene; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (
      cs.transform.startsWith("matrix3d") ||
      cs.transformStyle === "preserve-3d" ||
      cs.perspective !== "none" ||
      (cs.offsetPath ?? "none") !== "none"
    ) {
      return true;
    }
  }
  return false;
}

/** Elements a CSS animation or WAAPI animation moves (no inline style to diff). */
function pageAnimated(scene: Element): Set<HTMLElement> {
  const out = new Set<HTMLElement>();
  if (typeof document.getAnimations !== "function") return out;
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!isHtmlElement(target) || !scene.contains(target)) continue;
    const frames = typeof effect?.getKeyframes === "function" ? effect.getKeyframes() : [];
    if (frames.some((frame) => Object.keys(frame).some((k) => ANIMATED_POSE_PROPS.has(k))))
      out.add(target);
  }
  return out;
}

/** How far a box's farthest-moving edge travelled between two reads; 0 when either is empty. */
function edgeShift(a: DOMRect | undefined, b: DOMRect | undefined): number {
  if (!a || !b || !a.width || !b.width) return 0;
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  );
}

export function discoverMovers({ scene, durationSeconds, fps, seek }: DiscoverOptions): Discovery {
  const all = [...scene.querySelectorAll("*")].filter(isHtmlElement);
  const dynamic = new Set<Element>(pageAnimated(scene));
  const first = all.map(styleKey);
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  // One pass, about every other frame on a typical composition. A whip shorter than one step
  // can be under-measured; ponytail: raise SCAN_STEPS if a fast move goes unblurred.
  const steps = Math.min(frames, SCAN_STEPS);
  const framesPerStep = frames / steps;
  const fast = new Set<HTMLElement>();
  const threeD = new Set<HTMLElement>();
  let prev: Array<DOMRect | undefined> | null = null;

  for (let i = 0; i <= steps; i++) {
    seek((i / steps) * durationSeconds);
    // Rects only for elements whose style has changed; the first read flushes layout once.
    const rects: Array<DOMRect | undefined> = [];
    all.forEach((el, j) => {
      if (!dynamic.has(el) && styleKey(el) === first[j]) return;
      dynamic.add(el);
      rects[j] = el.getBoundingClientRect();
      if (edgeShift(prev?.[j], rects[j]) / framesPerStep >= MIN_SPEED) fast.add(el);
    });
    // Style reads up the chain are the costly part; every 10th step is enough to see a 3D turn.
    if (i % 10 === 0 || i === steps) for (const el of fast) if (in3d(el, scene)) threeD.add(el);
    prev = rects;
  }

  const candidates = all.filter((el) => fast.has(el) && !threeD.has(el) && !optedOut(el, scene));
  const movers = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));
  return { movers, dynamic };
}
