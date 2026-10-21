import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverMovers } from "./discover";

// jsdom lays nothing out: each element's rect follows the x its fake timeline writes.
function element(parent: Element, id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  parent.append(el);
  el.getBoundingClientRect = () => {
    const x = parseFloat(el.style.transform.replace("translateX(", "")) || 0;
    return { left: x, top: 0, right: x + 10, bottom: 10, width: 10, height: 10 } as DOMRect;
  };
  return el;
}

function setup() {
  const scene = document.createElement("div");
  const fast = element(scene, "fast");
  const fastChild = element(fast, "fast-child");
  const slow = element(scene, "slow");
  const still = element(scene, "still");
  const off = element(scene, "off");
  off.setAttribute("data-motion-blur", "off");
  // 1 s at 30 fps: `fast` and `off` cross 300 px (10 px/frame), `slow` 15 px (0.5 px/frame).
  const seek = (t: number): void => {
    fast.style.transform = `translateX(${300 * t}px)`;
    fastChild.style.transform = `translateX(${200 * t}px)`;
    slow.style.transform = `translateX(${15 * t}px)`;
    off.style.transform = `translateX(${300 * t}px)`;
  };
  seek(0);
  return { scene, fast, fastChild, slow, still, off, seek };
}

describe("discoverMovers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps fast, outermost movers that are not opted out", () => {
    const { scene, fast, seek } = setup();
    const { movers } = discoverMovers({ scene, durationSeconds: 1, fps: 30, seek });
    expect(movers).toEqual([fast]);
  });

  it("marks every changing element dynamic, slow and opted-out ones included", () => {
    const { scene, fast, fastChild, slow, still, off, seek } = setup();
    const { dynamic } = discoverMovers({ scene, durationSeconds: 1, fps: 30, seek });
    expect(
      dynamic.has(fast) && dynamic.has(fastChild) && dynamic.has(slow) && dynamic.has(off),
    ).toBe(true);
    expect(dynamic.has(still)).toBe(false);
  });

  it("ignores a CSS animation of offset-distance, which the pose has no term for", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    scene.append(box);
    let x = 0; // moves with no inline style change: only getAnimations can nominate it
    box.getBoundingClientRect = () =>
      ({ left: x, right: x + 10, top: 0, bottom: 10, width: 10 }) as DOMRect;
    const scan = (prop: string) => {
      const effect = { target: box, getKeyframes: () => [{ [prop]: "0" }] };
      Object.defineProperty(document, "getAnimations", {
        value: () => [{ effect }],
        configurable: true,
      });
      const seek = (t: number): void => void (x = 300 * t);
      return discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers;
    };
    expect(scan("offsetDistance")).toEqual([]);
    expect(scan("translate")).toEqual([box]);
    Reflect.deleteProperty(document, "getAnimations");
  });

  it("drops a mover in a 3D context, or on an offset-path the pose cannot follow", () => {
    const { scene, fast, seek } = setup();
    const real = window.getComputedStyle;
    let own: object = {};
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el === fast
        ? ({ transform: "none", transformStyle: "flat", perspective: "none", ...own } as never)
        : real(el),
    );
    for (own of [
      { transform: "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)" },
      { offsetPath: "path('M 0 0')" },
    ])
      expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([]);
  });
});
