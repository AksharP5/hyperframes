import { describe, it, expect, beforeEach } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type KeyframeCacheEntry } from "../player/store/playerStore";
import {
  clearKeyframeCacheForElement,
  clearKeyframeCacheForFile,
  pruneKeyframeCacheToFiles,
  updateKeyframeCacheFromParsed,
} from "./gsapKeyframeCacheHelpers";

const entry = (): KeyframeCacheEntry => ({
  format: "percentage",
  keyframes: [{ percentage: 0, properties: { x: 0 } }],
});

const seed = (key: string) => usePlayerStore.getState().setKeyframeCache(key, entry());
const cache = () => usePlayerStore.getState().keyframeCache;

const animWithKeyframes = (id: string): GsapAnimation => ({
  id,
  targetSelector: `#${id}`,
  method: "to",
  position: 0,
  properties: {},
  duration: 1,
  resolvedStart: 0,
  propertyGroup: "position",
  keyframes: { format: "percentage", keyframes: [{ percentage: 50, properties: { x: 100 } }] },
});

beforeEach(() => {
  usePlayerStore.setState({ keyframeCache: new Map(), gsapAnimations: new Map(), elements: [] });
});

describe("clearKeyframeCacheForElement", () => {
  it("drops the prefixed, index.html fallback, and bare key for a non-index source", () => {
    seed("comp.html#box");
    seed("index.html#box");
    seed("box");

    clearKeyframeCacheForElement("comp.html", "box");

    expect(cache().has("comp.html#box")).toBe(false);
    expect(cache().has("index.html#box")).toBe(false);
    // The bare key is what PropertyPanel's keyframe nav reads (element.id), so
    // it must be cleared too, not just the prefixed variants.
    expect(cache().has("box")).toBe(false);
  });

  it("drops the prefixed and bare key for an index.html source", () => {
    seed("index.html#hero");
    seed("hero");

    clearKeyframeCacheForElement("index.html", "hero");

    expect(cache().has("index.html#hero")).toBe(false);
    expect(cache().has("hero")).toBe(false);
  });

  it("leaves other elements' keys untouched", () => {
    seed("index.html#box");
    seed("box");
    seed("index.html#other");
    seed("other");

    clearKeyframeCacheForElement("index.html", "box");

    expect(cache().has("index.html#other")).toBe(true);
    expect(cache().has("other")).toBe(true);
  });
});

describe("clearKeyframeCacheForFile", () => {
  it("clears the prefixed, fallback, and bare keys for every element of the file", () => {
    seed("comp.html#a");
    seed("index.html#a");
    seed("a");
    seed("comp.html#b");
    seed("b");

    clearKeyframeCacheForFile("comp.html");

    for (const key of ["comp.html#a", "index.html#a", "a", "comp.html#b", "b"]) {
      expect(cache().has(key)).toBe(false);
    }
  });

  // Several composition files re-scan concurrently, so a clear that walked the
  // index.html alias would delete rows a sibling file had just written.
  it("leaves an index.html-owned element alone when another file re-scans", () => {
    seed("index.html#title");
    seed("title");
    seed("comp.html#a");

    clearKeyframeCacheForFile("comp.html");

    expect(cache().has("index.html#title")).toBe(true);
    expect(cache().has("title")).toBe(true);
    expect(cache().has("comp.html#a")).toBe(false);
  });

  it("leaves entries that belong to a different source file", () => {
    seed("comp.html#a");
    seed("a");
    seed("other.html#z");
    seed("z");

    clearKeyframeCacheForFile("comp.html");

    expect(cache().has("other.html#z")).toBe(true);
    expect(cache().has("z")).toBe(true);
  });
});

describe("pruneKeyframeCacheToFiles", () => {
  // Switching composition leaves the previous comp's elements cached with no
  // owner left to clear them: each file only ever clears its own entries.
  it("drops every element of a file the next scan no longer covers", () => {
    seed("index.html#stress-1");
    seed("stress-1");
    seed("index.html#stress-2");
    seed("stress-2");
    seed("kf200.html#kf200");
    seed("index.html#kf200");
    seed("kf200");

    pruneKeyframeCacheToFiles(["kf200.html"]);

    for (const key of ["index.html#stress-1", "stress-1", "index.html#stress-2", "stress-2"]) {
      expect(cache().has(key)).toBe(false);
    }
    expect(cache().has("kf200.html#kf200")).toBe(true);
  });

  it("prunes gsapAnimations alongside keyframeCache", () => {
    usePlayerStore.getState().setGsapAnimations("index.html#stress-1", [animWithKeyframes("t")]);
    usePlayerStore.getState().setGsapAnimations("kf200.html#kf200", [animWithKeyframes("u")]);

    pruneKeyframeCacheToFiles(["kf200.html"]);

    const animations = usePlayerStore.getState().gsapAnimations;
    expect(animations.has("index.html#stress-1")).toBe(false);
    expect(animations.has("kf200.html#kf200")).toBe(true);
  });

  it("keeps everything when every cached file is still covered", () => {
    seed("index.html#hero");
    seed("comp.html#a");

    pruneKeyframeCacheToFiles(["index.html", "comp.html"]);

    expect(cache().has("index.html#hero")).toBe(true);
    expect(cache().has("comp.html#a")).toBe(true);
  });
});

describe("updateKeyframeCacheFromParsed", () => {
  it("records colliding animation targets with their own tween percentages", () => {
    const animation = (
      id: string,
      propertyGroup: string,
      properties: Record<string, number>,
      percentage: number,
      resolvedStart: number,
    ): GsapAnimation => ({
      ...animWithKeyframes(id),
      targetSelector: "#hero",
      propertyGroup,
      resolvedStart,
      keyframes: { format: "percentage", keyframes: [{ percentage, properties }] },
    });

    usePlayerStore.setState({
      elements: [{ id: "hero", domId: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
    });

    updateKeyframeCacheFromParsed(
      [
        animation("hero-position", "position", { x: 100 }, 50, 0.5),
        animation("hero-visual", "visual", { opacity: 1 }, 80, 0.2),
        animation("hero-position", "position", { y: 50 }, 25, 0.75),
        animation("hero-scale", "scale", { scale: 2 }, 60, 0.4),
      ],
      "scene.html",
      "hero",
      {},
    );

    expect(cache().get("scene.html#hero")?.keyframes[0]?.collidingAnimationTargets).toEqual([
      { animationId: "hero-position", tweenPercentage: 50 },
      { animationId: "hero-visual", tweenPercentage: 80 },
      { animationId: "hero-scale", tweenPercentage: 60 },
    ]);
  });

  it("serializes a multi-keyframe tween with a stable shape and animation identity", () => {
    const animation: GsapAnimation = {
      ...animWithKeyframes("hero"),
      duration: 2,
      resolvedStart: 3,
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { x: 0 } },
          { percentage: 50, properties: { x: 100 }, ease: "power1.inOut" },
          { percentage: 100, properties: { x: 200 } },
        ],
        easeEach: "power1.inOut",
      },
    };
    usePlayerStore.setState({
      elements: [
        {
          id: "hero-clip",
          domId: "hero",
          tag: "div",
          start: 2,
          duration: 4,
          track: 0,
        },
      ],
    });

    updateKeyframeCacheFromParsed([animation], "scene.html", "hero", {});

    expect(JSON.stringify(cache().get("scene.html#hero"))).toBe(
      '{"format":"percentage","keyframes":[{"percentage":25,"properties":{"x":0},"tweenPercentage":0,"propertyGroup":"position","animationId":"hero"},{"percentage":50,"properties":{"x":100},"ease":"power1.inOut","tweenPercentage":50,"propertyGroup":"position","animationId":"hero"},{"percentage":75,"properties":{"x":200},"tweenPercentage":100,"propertyGroup":"position","animationId":"hero"}],"easeEach":"power1.inOut"}',
    );
  });

  it("clears the bare key when the selected element no longer has keyframes", () => {
    // Element previously had keyframes, so a bare entry exists (writes set both).
    seed("index.html#box");
    seed("box");

    // A mutation leaves #box without any keyframes in the parsed animations.
    updateKeyframeCacheFromParsed([], "index.html", "box", {});

    expect(cache().has("index.html#box")).toBe(false);
    // Without the bare-key clear this assertion fails: the stale entry survives
    // and PropertyPanel keeps rendering the removed keyframes.
    expect(cache().has("box")).toBe(false);
  });

  it("still writes the bare key for elements that have keyframes", () => {
    updateKeyframeCacheFromParsed([animWithKeyframes("hero")], "index.html", "hero", {});

    expect(cache().has("index.html#hero")).toBe(true);
    expect(cache().has("hero")).toBe(true);
  });

  it("caches flat tweens as clip-relative start and end keyframes", () => {
    const animation: GsapAnimation = {
      id: "flat-box",
      targetSelector: "#box",
      method: "to",
      position: 1,
      properties: { x: 420 },
      duration: 2,
      resolvedStart: 1,
      ease: "power2.out",
      propertyGroup: "position",
    };
    usePlayerStore.setState({
      elements: [{ id: "box-clip", domId: "box", tag: "div", start: 1, duration: 2, track: 0 }],
    });

    updateKeyframeCacheFromParsed([animation], "scene.html", "box", {});

    expect(cache().get("scene.html#box")).toEqual({
      format: "percentage",
      keyframes: [
        {
          percentage: 0,
          properties: { x: 0 },
          tweenPercentage: 0,
          propertyGroup: "position",
          animationId: "flat-box",
        },
        {
          percentage: 100,
          properties: { x: 420 },
          ease: "power2.out",
          tweenPercentage: 100,
          propertyGroup: "position",
          animationId: "flat-box",
        },
      ],
    });
    expect(usePlayerStore.getState().gsapAnimations.get("scene.html#box")).toEqual([animation]);
  });

  it("records an ungrouped tween in gsapAnimations too, so the two stores agree", () => {
    // `{ x, opacity }` spans two property groups, so the parser leaves
    // propertyGroup undefined. Skipping it here used to cache diamonds with no
    // source animation behind them: the collapsed row drew keyframes the
    // expanded lanes could not render.
    const animation: GsapAnimation = {
      id: "mixed-box",
      targetSelector: "#box",
      method: "to",
      position: 0,
      properties: { x: 100, opacity: 0 },
      duration: 1,
      resolvedStart: 0,
    };
    usePlayerStore.setState({
      elements: [{ id: "box-clip", domId: "box", tag: "div", start: 0, duration: 1, track: 0 }],
    });

    updateKeyframeCacheFromParsed([animation], "scene.html", "box", {});

    expect(cache().has("scene.html#box")).toBe(true);
    expect(usePlayerStore.getState().gsapAnimations.get("scene.html#box")).toEqual([animation]);
  });

  // `#stat3 .block` animates the BLOCK inside #stat3, not #stat3. An unanchored
  // `^#([\w-]+)/` prefix match filed it under "stat3", which both stole the
  // child's diamonds and collided with #stat3's own tween at the shared
  // percentage (dropping #stat3's ease as ambiguous).
  it("attributes a descendant selector to the child, not to its ancestor", () => {
    const parent: GsapAnimation = {
      id: "stat3-fromTo",
      targetSelector: "#stat3",
      method: "fromTo",
      position: 8.88,
      resolvedStart: 8.88,
      duration: 0.25,
      fromProperties: { y: 20 },
      properties: { y: 0 },
      ease: "power2.out",
      propertyGroup: "position",
    };
    const child: GsapAnimation = {
      id: "block-from",
      targetSelector: "#stat3 .block",
      method: "from",
      position: 9.13,
      resolvedStart: 9.13,
      duration: 0.3,
      properties: { opacity: 0 },
      ease: "power2.in",
      propertyGroup: "visual",
    };
    usePlayerStore.setState({
      elements: [
        { id: "stat3-clip", domId: "stat3", tag: "div", start: 8.88, duration: 1, track: 0 },
      ],
    });
    const doc = {
      querySelectorAll: (selector: string) =>
        (selector === "#stat3 .block"
          ? [{ id: "stat3-block" }]
          : []) as unknown as NodeListOf<Element>,
    } as unknown as Document;

    updateKeyframeCacheFromParsed([parent, child], "scene.html", "stat3", {}, doc);

    expect(usePlayerStore.getState().gsapAnimations.get("scene.html#stat3")).toEqual([parent]);
    expect(usePlayerStore.getState().gsapAnimations.get("scene.html#stat3-block")).toEqual([child]);
    // With the collision gone, #stat3's own curve survives instead of being
    // deleted as an ambiguous same-percentage merge.
    const parentKeyframes = cache().get("scene.html#stat3")?.keyframes ?? [];
    expect(parentKeyframes.at(-1)?.ease).toBe("power2.out");
    expect(parentKeyframes.some((keyframe) => "easeAmbiguous" in keyframe)).toBe(false);
  });

  it("attributes a descendant selector to nothing when there is no document", () => {
    const child: GsapAnimation = {
      ...animWithKeyframes("block-from"),
      targetSelector: "#stat3 .block",
    };

    updateKeyframeCacheFromParsed([child], "scene.html", "stat3", {});

    expect(cache().has("scene.html#stat3")).toBe(false);
    expect(usePlayerStore.getState().gsapAnimations.has("scene.html#stat3")).toBe(false);
  });

  it("does not cache a flat tween without animatable numeric properties", () => {
    const animation: GsapAnimation = {
      id: "flat-box",
      targetSelector: "#box",
      method: "to",
      position: 0,
      properties: { backgroundColor: "#fff" },
      duration: 1,
      propertyGroup: "visual",
    };

    updateKeyframeCacheFromParsed([animation], "scene.html", "box", {});

    expect(cache().has("scene.html#box")).toBe(false);
    expect(cache().has("box")).toBe(false);
    expect(usePlayerStore.getState().gsapAnimations.has("scene.html#box")).toBe(false);
  });
});
