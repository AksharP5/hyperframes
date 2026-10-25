import { afterEach, describe, expect, it } from "vitest";
import gsap from "gsap";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

// Importing gsap installs it on window; a test opts in by setting window.gsap itself.
delete window.gsap;

function mountClipHiddenByTimeline() {
  document.body.innerHTML =
    `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="5" data-width="640" data-height="360">` +
    `<div id="clip" class="clip" data-start="0" data-duration="5"></div>` +
    `<div id="late" class="clip" data-start="1" data-duration="4"></div>` +
    `</div>`;
  const tl = gsap.timeline({ paused: true });
  tl.set("#clip", { visibility: "hidden" }, 2.67);
  tl.set("#late", { visibility: "hidden" }, 2.67);
  window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
  const parent = window.parent;
  Object.defineProperty(window, "parent", { configurable: true, value: {} });
  try {
    initSandboxRuntimeModular();
  } finally {
    Object.defineProperty(window, "parent", { configurable: true, value: parent });
  }
  return { clip: document.getElementById("clip")!, late: document.getElementById("late")! };
}

describe("a timeline set that hides a timed clip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const paths = {
    preview: (t: number) => window.__player?.seek(t),
    render: (t: number) => window.__player?.renderSeek(t),
  };

  for (const [name, seek] of Object.entries(paths)) {
    const visibilityAt = (times: number[]) => {
      const { clip, late } = mountClipHiddenByTimeline();
      return times.map((t) => {
        seek(t);
        return `${clip.style.visibility}/${late.style.visibility}`;
      });
    };

    it(`hides the clip from its position on the ${name} path`, () => {
      expect(visibilityAt([0.5, 1.5, 2.6, 2.7, 4, 2.6, 1.5])).toEqual([
        "visible/hidden",
        "visible/visible",
        "visible/visible",
        "hidden/hidden",
        "hidden/hidden",
        "visible/visible",
        "visible/visible",
      ]);
    });

    it(`hides the clip on a first seek past its position on the ${name} path`, () => {
      expect(visibilityAt([3]).map((seen) => seen.split("/")[0])).toEqual(["hidden"]);
    });
  }

  for (const [name, seek] of Object.entries(paths)) {
    it(`hides the timed children of a scene a script hides on the ${name} path`, () => {
      document.body.innerHTML =
        `<div data-composition-id="main" data-root="true" data-start="0" data-duration="5" data-width="640" data-height="360">` +
        `<div id="scene" class="clip" data-start="0" data-duration="5">` +
        `<div id="kid" class="clip" data-start="0" data-duration="5"></div><div id="plain"></div></div></div>`;
      const tl = gsap.timeline({ paused: true });
      tl.set("#scene", { visibility: "hidden" }, 2.67);
      window.__timelines = { main: tl as unknown as RuntimeTimelineLike };
      const parent = window.parent;
      Object.defineProperty(window, "parent", { configurable: true, value: {} });
      try {
        initSandboxRuntimeModular();
      } finally {
        Object.defineProperty(window, "parent", { configurable: true, value: parent });
      }
      const computed = () =>
        ["scene", "kid", "plain"].map(
          (id) => getComputedStyle(document.getElementById(id)!).visibility[0],
        );
      const seen: string[] = [];
      for (const t of [1, 3, 3.5, 1]) {
        seek(t);
        seen.push(computed().join(""));
      }
      expect(seen).toEqual(["vvv", "hhh", "hhh", "vvv"]);
    });
  }
});
