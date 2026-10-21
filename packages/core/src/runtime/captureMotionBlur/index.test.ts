import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CaptureMotionBlurHost,
  initCaptureMotionBlur,
  paintCaptureMotionBlur,
  releaseCaptureMotionBlurFrame,
  resetCaptureMotionBlurForTests,
  trackAcceleratedCanvases,
} from ".";

type Win = Window & {
  __HF_PAGE_MOTION_BLUR_OFF__?: unknown;
  __hfMotionBlur?: {
    report: () => {
      state: string;
      reason: string | null;
      shutterDeg: number;
      moverNames: string[];
    };
  };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
};
const win = window as Win;

// Every 2D context (page canvas or offscreen) is this recording fake.
function fakeContext() {
  return {
    reset: vi.fn(),
    drawElementImage: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
}
let contexts: Array<ReturnType<typeof fakeContext>> = [];

function installHtmlInCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const ctx = fakeContext();
    contexts.push(ctx);
    return ctx as never;
  });
  vi.stubGlobal(
    "CanvasRenderingContext2D",
    class {
      drawElementImage(): void {}
    },
  );
  (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = () => {};
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return fakeContext();
      }
    },
  );
}

function makeRoot(attrs: Record<string, string> = { "data-motion-blur": "on" }): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", "main");
  root.setAttribute("data-width", "640");
  root.setAttribute("data-height", "360");
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  document.body.append(root);
  return root;
}

function host(
  root: HTMLElement,
  seek = vi.fn(),
): CaptureMotionBlurHost & { seek: ReturnType<typeof vi.fn> } {
  return { root, fps: 30, durationSeconds: () => 1, timeline: () => "tl", seek };
}

const captureCanvas = (root: HTMLElement) => root.parentElement as HTMLCanvasElement;

beforeEach(() => {
  contexts = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetCaptureMotionBlurForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint;
  delete win.__HF_PAGE_MOTION_BLUR_OFF__;
  delete win.__hfMotionBlur;
  delete win.__hf_page_composite_pending;
  delete win.__hf_page_composite_resolve;
  document.body.innerHTML = "";
});

/** A root with one 10×10 element that slides 300 px over the 1 s composition (10 px/frame). */
function movingHost(attrs?: Record<string, string>) {
  const root = makeRoot(attrs);
  const el = document.createElement("div");
  el.id = "slider";
  root.append(el);
  for (const [k, v] of Object.entries({
    offsetWidth: 10,
    offsetHeight: 10,
    offsetLeft: 0,
    offsetTop: 0,
    offsetParent: root,
  })) {
    Object.defineProperty(el, k, { value: v, configurable: true });
  }
  const x = () => Number(/,\s*([-\d.]+),\s*0\)$/.exec(el.style.transform)?.[1] ?? 0);
  el.getBoundingClientRect = () =>
    ({ left: x(), top: 0, right: x() + 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
  const seek = vi.fn((t: number) => {
    el.style.transform = `matrix(1, 0, 0, 1, ${300 * t}, 0)`;
  });
  return { root, el, h: host(root, seek) };
}

const PLAY = { playing: true };

describe("opt-in and off switches", () => {
  it("does nothing for a root that has not opted in", () => {
    installHtmlInCanvas();
    const root = makeRoot({});
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
    expect(paintCaptureMotionBlur(0)).toBeNull();
    expect(win.__hfMotionBlur).toBeUndefined();
  });

  it("stays off without html-in-canvas and says why", () => {
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reason: expect.stringContaining("html-in-canvas"),
    });
  });

  it("stays off while the engine's own sub-frame blur is on (never both)", () => {
    installHtmlInCanvas();
    win.__HF_PAGE_MOTION_BLUR_OFF__ = "engine-motion-blur";
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(paintCaptureMotionBlur(0.5, PLAY)).toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reason).toContain("engine");
  });

  it("stays off for a WebGL canvas, which html-in-canvas captures frozen, but not for a 2D one", () => {
    installHtmlInCanvas();
    trackAcceleratedCanvases();
    const root = makeRoot();
    const flat = document.createElement("canvas");
    root.append(flat);
    flat.getContext("2d");
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().state).toBe("on");

    resetCaptureMotionBlurForTests();
    const gl = document.createElement("canvas");
    root.append(gl);
    gl.getContext("webgl");
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().reason).toMatch(/WebGL/);
  });

  it("turns off instead of wrapping when a WebGL canvas appears after init", () => {
    installHtmlInCanvas();
    trackAcceleratedCanvases();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const late = document.createElement("canvas");
    root.append(late);
    late.getContext("webgl2");
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().reason).toMatch(/WebGL/);
  });
});

describe("wrapping", () => {
  it("wraps the root itself in a capture canvas, with an output canvas after it", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    expect(root.parentElement).toBe(document.body); // not until it plays
    void paintCaptureMotionBlur(0.5, PLAY);
    const src = captureCanvas(root);
    expect(src.tagName).toBe("CANVAS");
    expect(src.hasAttribute("layoutsubtree")).toBe(true);
    expect(src.hasAttribute("data-hf-ignore")).toBe(true);
    expect([src.width, src.height]).toEqual([640, 360]);
    const out = src.nextElementSibling as HTMLElement;
    expect(out.getAttribute("data-hf-motion-blur")).toBe("output");
    // The output sits over the composition: clicks must reach what is under it.
    expect(out.style.pointerEvents).toBe("none");
  });

  it("turns off instead of wrapping when a capture canvas appears after init", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const late = document.createElement("canvas");
    late.setAttribute("layoutsubtree", "");
    root.append(late);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report().state).toBe("off");
  });
});

describe("paint timeouts", () => {
  const HIDE = "data-hf-motion-blur-hide";
  const info = () => vi.mocked(console.info);
  const engineFrame = (t: number): Promise<void> | null => {
    const done = paintCaptureMotionBlur(t, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    return done;
  };
  const plainDom = (root: HTMLElement): void => {
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  };

  it("renders a released frame whose paint never comes plain, counts it, and leaves nothing for the engine to finish (first frame, output never drawn)", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = engineFrame(0.5);
    expect(captureCanvas(root).tagName).toBe("CANVAS");
    await vi.advanceTimersByTimeAsync(2001);
    await done;
    plainDom(root);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 0,
      failedFrames: 1,
    });
    expect(info()).toHaveBeenCalledWith(
      expect.stringMatching(/capture failed \(1 so far\).*paint/),
    );
    win.__hf_page_composite_resolve?.(); // the engine's forced composite arrives late
    plainDom(root);
    expect(contexts[0]?.drawElementImage).not.toHaveBeenCalled();
    expect(win.__hf_page_composite_pending).toBe(false);
    void paintCaptureMotionBlur(0.6, { engineMode: true }); // the next frame wraps again
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("does the same for a frame after one that painted, whose output already holds an earlier frame", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = engineFrame(0.5);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await first;
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failedFrames: 0, frames: 1 });
    const captures = contexts[0]?.drawElementImage.mock.calls.length;
    const second = engineFrame(0.6);
    await vi.advanceTimersByTimeAsync(2001);
    await second;
    plainDom(root);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ failures: 0, failedFrames: 1 });
    win.__hf_page_composite_resolve?.();
    plainDom(root);
    expect(contexts[0]?.drawElementImage.mock.calls.length).toBe(captures);
  });

  it("keeps blurring through preview paint timeouts, each frame plain, and resumes when painting returns", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    for (let i = 0; i < 4; i++) {
      void paintCaptureMotionBlur(i / 30, PLAY);
      expect(captureCanvas(root).tagName).toBe("CANVAS");
      await vi.advanceTimersByTimeAsync(2000);
      plainDom(root);
    }
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "on",
      failures: 0,
      failedFrames: 4,
    });
    expect(info()).toHaveBeenCalledTimes(1);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(contexts[0]?.drawElementImage).toHaveBeenCalled();
  });
});
