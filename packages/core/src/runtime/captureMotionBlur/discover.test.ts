import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverMovers } from "./discover";

// jsdom lays nothing out: each element's rect follows the x its fake timeline writes.
function element(parent: Element, id: string, size = 10, tag = "div"): HTMLElement {
  const el = document.createElement(tag);
  el.id = id;
  parent.append(el);
  el.getBoundingClientRect = () => {
    const x = parseFloat(el.style.transform.replace("translateX(", "")) || 0;
    return { left: x, top: 0, right: x + size, bottom: size, width: size, height: size } as DOMRect;
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

  it("drops a mover with a 3D rotate axis or a z translate", () => {
    for (const style of [{ rotate: "x 30deg" }, { translate: "1px 2px 3px" }]) {
      const { scene, fast, seek } = setup();
      const real = window.getComputedStyle;
      vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
        el === fast
          ? ({
              transform: "none",
              transformStyle: "flat",
              perspective: "none",
              ...style,
            } as CSSStyleDeclaration)
          : real(el),
      );
      expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  describe("an element holding more of the scene than it owns", () => {
    // A 100 x 100 scene; `big` is 100 x 100 and slides 10 px/frame, `small` rides inside it.
    function sceneWith(tag = "div") {
      const scene = document.createElement("div");
      scene.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
      const big = element(scene, "big", 100, tag);
      const small = element(big, "small");
      const seek = (t: number): void => {
        big.style.transform = `translateX(${300 * t}px)`;
        small.style.transform = `translateX(${300 * t}px)`;
      };
      seek(0);
      const movers = (): HTMLElement[] =>
        discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers;
      return { big, small, movers };
    }

    it("is no mover when it is a translucent sweep", () => {
      const { big, movers } = sceneWith();
      big.style.opacity = "0.5";
      big.style.backgroundImage = "linear-gradient(90deg, rgba(0, 0, 0, 0), red)";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its gradient fades to transparent", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundImage = "linear-gradient(90deg, rgba(255, 0, 0, 0), rgb(255, 0, 0))";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its background colour is see-through", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it has no paint of its own", () => {
      const { big, movers } = sceneWith();
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it fades", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      big.style.opacity = "0.6";
      expect(movers()).not.toContain(big);
    });

    it("hands the blur to what it holds", () => {
      const { big, small, movers } = sceneWith();
      big.style.opacity = "0.5";
      expect(movers()).toEqual([small]);
    });

    it("stays a mover when opaque", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      expect(movers()).toEqual([big]);
    });

    it("stays a mover when it is an opaque gradient", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundImage = "linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 0, 0))";
      expect(movers()).toEqual([big]);
    });

    // jsdom has no canvas: the alpha probe's canvas is faked, `alphas` being the pixels it reads.
    function withImage(tag: "img" | "canvas", alphas: number[] | "tainted") {
      const sc = sceneWith(tag);
      if (tag === "img") {
        Object.defineProperty(sc.big, "complete", { value: true });
        Object.defineProperty(sc.big, "naturalWidth", { value: 1600, configurable: true });
      }
      const draws = vi.fn();
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((name: string) => {
        if (name !== "canvas") return realCreate(name);
        const ctx = {
          drawImage: draws,
          getImageData: () => {
            if (alphas === "tainted") throw new DOMException("tainted", "SecurityError");
            return { data: Uint8ClampedArray.from(alphas.flatMap((a) => [0, 0, 0, a])) };
          },
        };
        return { getContext: () => ctx } as unknown as HTMLCanvasElement;
      });
      return { ...sc, draws };
    }

    it("stays a mover when it is an opaque image", () => {
      const { big, movers, draws } = withImage("img", [255, 255, 255, 255]);
      expect(movers()).toEqual([big]);
      expect(draws).toHaveBeenCalledTimes(1);
    });

    it("is no mover when it is an image with alpha", () => {
      const { big, movers } = withImage("img", [255, 255, 128, 255]);
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it is a canvas with alpha", () => {
      const { big, movers } = withImage("canvas", [0, 255]);
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its pixels cannot be read", () => {
      const { big, movers } = withImage("img", "tainted");
      expect(movers()).not.toContain(big);
    });

    it("is no mover when the image is not decoded", () => {
      const { big, movers } = withImage("img", [255]);
      Object.defineProperty(big, "naturalWidth", { value: 0, configurable: true });
      expect(movers()).not.toContain(big);
    });

    it("stays a mover when it is a video", () => {
      const { big, movers } = sceneWith("video");
      expect(movers()).toEqual([big]);
    });

    it("stays a mover while it is off screen at zero opacity", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      big.style.opacity = "0";
      expect(movers()).toEqual([big]);
    });
  });

  it("keeps a small box without paint of its own: its crop matches the background", () => {
    const { scene, fast, seek } = setup();
    scene.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    fast.style.opacity = "0.5";
    expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([fast]);
  });
});
