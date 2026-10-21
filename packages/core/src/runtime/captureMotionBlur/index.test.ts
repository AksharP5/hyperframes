import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CaptureMotionBlurHost,
  captureMotionBlurBusy,
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
const captureContext = () => contexts[0];

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
  return { root, fps: 30, durationSeconds: () => 1, timeline: () => "tl", now: () => 0, seek };
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
  Reflect.deleteProperty(document, "visibilityState");
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

  it("stays off in a browser with canvas but without drawElementImage (stable Chrome)", () => {
    installHtmlInCanvas();
    vi.stubGlobal("CanvasRenderingContext2D", class {});
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
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

  it("says why it is off to a root that asked for it", () => {
    initCaptureMotionBlur(host(makeRoot()));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("html-in-canvas"));
  });

  it("stays off when the composition already nests a capture canvas", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    const inner = document.createElement("canvas");
    inner.setAttribute("layoutsubtree", "");
    root.append(inner);
    initCaptureMotionBlur(host(root));
    expect(root.parentElement).toBe(document.body);
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

  it("clamps the shutter angle", () => {
    installHtmlInCanvas();
    const root = makeRoot({ "data-motion-blur": "on", "data-motion-blur-shutter": "9999" });
    initCaptureMotionBlur(host(root));
    expect(win.__hfMotionBlur?.report().shutterDeg).toBe(720);
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

  it("unwraps when the root opts back out", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    root.removeAttribute("data-motion-blur");
    initCaptureMotionBlur(h);
    expect(root.parentElement).toBe(document.body);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(win.__hfMotionBlur).toBeUndefined();
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

  it("never wraps a composition where nothing moves", () => {
    installHtmlInCanvas();
    const root = makeRoot();
    initCaptureMotionBlur(host(root));
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
  });

  it("hides each move of the root from the runtime and re-seeks right after it (R9)", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    const events: string[] = [];
    const base = h.seek;
    const spied = {
      ...h,
      now: () => 0.5,
      seek: (t: number, suppress: boolean) => {
        base(t, suppress);
        events.push(`seek:${t}:${suppress}`);
      },
      ignoreMutations: (write: () => void) => {
        events.push("quiet:begin");
        write();
        events.push(`quiet:end:${root.parentElement === document.body ? "plain" : "wrapped"}`);
      },
    };
    initCaptureMotionBlur(spied);
    events.length = 0;
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(events.slice(events.indexOf("quiet:begin")).slice(0, 3)).toEqual([
      "quiet:begin",
      "quiet:end:wrapped",
      "seek:0.5:true",
    ]);
    events.length = 0;
    expect(paintCaptureMotionBlur(0.5)).toBeNull(); // paused: unwraps
    expect(events).toEqual(["quiet:begin", "quiet:end:plain", "seek:0.5:true"]);
  });

  it("does not re-seek when there was nothing to unwrap", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    h.seek.mockClear();
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(h.seek).not.toHaveBeenCalled();
  });

  it("hides each move of the root from the runtime and re-seeks right after it (R9)", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    const events: string[] = [];
    const base = h.seek;
    const spied = {
      ...h,
      now: () => 0.5,
      seek: (t: number, suppress: boolean) => {
        base(t, suppress);
        events.push(`seek:${t}:${suppress}`);
      },
      ignoreMutations: (write: () => void) => {
        events.push("quiet:begin");
        write();
        events.push(`quiet:end:${root.parentElement === document.body ? "plain" : "wrapped"}`);
      },
    };
    initCaptureMotionBlur(spied);
    events.length = 0;
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(events.slice(events.indexOf("quiet:begin")).slice(0, 3)).toEqual([
      "quiet:begin",
      "quiet:end:wrapped",
      "seek:0.5:true",
    ]);
    events.length = 0;
    expect(paintCaptureMotionBlur(0.5)).toBeNull(); // paused: unwraps
    expect(events).toEqual(["quiet:begin", "quiet:end:plain", "seek:0.5:true"]);
  });

  it("does not re-seek when there was nothing to unwrap", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    h.seek.mockClear();
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(h.seek).not.toHaveBeenCalled();
  });

  it("unwraps when paused, so Studio can select inside, and wraps again on play", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const inFlight = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint")); // movers hidden mid-frame
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    await inFlight; // the dropped frame still settles
    expect(root.parentElement).toBe(document.body);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("never unwraps once the engine drives frames", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    // A paused-style request from the transport during a render: it still paints.
    expect(paintCaptureMotionBlur(0.5)).not.toBeNull();
    expect(captureCanvas(root).tagName).toBe("CANVAS");
  });

  it("shows the first frame after wrapping sharp, not the last one from before", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(contexts[1]?.drawImage).toHaveBeenCalledWith(captureCanvas(root), 0, 0);
  });
});

const HIDE = "data-hf-motion-blur-hide";

describe("two-phase frames", () => {
  it("hides the movers for a background capture, then reveals them and settles", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(win.__hfMotionBlur?.report().moverNames).toEqual(["div#slider"]);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(2);
  });

  it("is busy from the first paint request until the frame is drawn (R11)", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    expect(captureMotionBlurBusy()).toBe(false);
    initCaptureMotionBlur(h);
    expect(captureMotionBlurBusy()).toBe(false);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(captureMotionBlurBusy()).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(captureMotionBlurBusy()).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(captureMotionBlurBusy()).toBe(false);
  });

  it("is no longer busy when a paused request unwraps a frame in flight", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(captureMotionBlurBusy()).toBe(false);
  });

  it("does not abandon a frame in flight: newer requests collapse into the latest", async () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint")); // movers cropped, now hidden
    const seeksBefore = h.seek.mock.calls.length;
    const second = paintCaptureMotionBlur(0.6, PLAY);
    const third = paintCaptureMotionBlur(0.7, PLAY);
    // Queued, not started: no pose reads yet, and the first frame keeps its movers hidden.
    expect(h.seek.mock.calls.length).toBe(seeksBefore);
    expect(el.hasAttribute(HIDE)).toBe(true);
    captureCanvas(root).dispatchEvent(new Event("paint")); // first frame done → 0.7 starts
    await first;
    expect(h.seek.mock.calls.at(-1)?.[0]).toBe(0.7);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await Promise.all([second, third]);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("reveals the movers if the second paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(el.hasAttribute(HIDE)).toBe(false);
  });

  it("finishes in one capture when the engine's step runs before any paint", () => {
    installHtmlInCanvas();
    const { el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    win.__hf_page_composite_resolve?.();
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });

  it("lets the engine's composite step finish a half-done frame", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    win.__hf_page_composite_resolve?.();
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(2);
  });

  it("starts an engine frame's paint wait on release, so slow video injection cannot drop it", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    await vi.advanceTimersByTimeAsync(5000);
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });

  it("gives up on a released engine frame whose paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    let settled = false;
    void paintCaptureMotionBlur(0.5, { engineMode: true })?.then(() => (settled = true));
    releaseCaptureMotionBlurFrame();
    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(true);
  });

  it("leaves the engine's composite step idle when nothing moves", () => {
    installHtmlInCanvas();
    initCaptureMotionBlur(host(makeRoot()));
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(win.__hf_page_composite_pending).toBeUndefined();
  });

  it("holds an engine frame until released, so injected video frames are in its capture", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    initCaptureMotionBlur(h);
    const requestPaint = vi.fn();
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = requestPaint;
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(requestPaint).not.toHaveBeenCalled();
    expect(captureContext()?.drawElementImage).not.toHaveBeenCalled();
    releaseCaptureMotionBlurFrame();
    expect(requestPaint).toHaveBeenCalledTimes(1);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
  });
});

describe("painting", () => {
  it("captures the root on the next paint and settles the frame", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    expect(done).not.toBeNull();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(captureContext()?.drawElementImage).toHaveBeenCalledWith(root, 0, 0);
    // Reset before each capture and again after it: the capture canvas sits under the output
    // and must never show its own bitmap (a transparent composition would show it doubled).
    expect(captureContext()?.reset).toHaveBeenCalledTimes(4);
    // The discovery scan's last word is the frame time: the page is left where it was seeked.
    expect(h.seek.mock.calls.at(-1)?.[0]).toBe(0.5);
  });

  it("seeks pose reads with events suppressed unless the root allows them", () => {
    installHtmlInCanvas();
    const quiet = host(makeRoot());
    initCaptureMotionBlur(quiet);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(quiet.seek.mock.calls.every(([, suppress]) => suppress === true)).toBe(true);

    resetCaptureMotionBlurForTests();
    const eventful = movingHost({
      "data-motion-blur": "on",
      "data-motion-blur-events": "on",
    }).h;
    initCaptureMotionBlur(eventful);
    void paintCaptureMotionBlur(0.5, PLAY);
    const calls = eventful.seek.mock.calls;
    expect(calls.at(-1)?.[1]).toBe(false);
    expect(calls.some(([, suppress]) => suppress === false)).toBe(true);
  });

  it("never fires timeline callbacks during discovery, even with events on", () => {
    installHtmlInCanvas();
    const { h } = movingHost({ "data-motion-blur": "on", "data-motion-blur-events": "on" });
    const fired: number[] = [];
    const callAtOnePointSeven = (t: number, suppress: boolean) => {
      h.seek(t, suppress);
      if (!suppress && t >= 0.7) fired.push(t);
    };
    initCaptureMotionBlur({ ...h, seek: callAtOnePointSeven });
    void paintCaptureMotionBlur(0.1, PLAY);
    expect(win.__hfMotionBlur?.report().movers).toBe(1);
    expect(fired).toEqual([]);
    const quiet = h.seek.mock.calls.filter(([, suppress]) => suppress === true);
    expect(quiet.some(([t]) => t === 0.1)).toBe(true);
  });

  it("in engine mode composes with the prior composite owner and draws even without a paint event", () => {
    installHtmlInCanvas();
    const prior = vi.fn(() => true);
    win.__hf_page_composite_resolve = prior;
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(win.__hf_page_composite_pending).toBe(true);
    win.__hf_page_composite_resolve?.();
    expect(prior).toHaveBeenCalled();
    expect(captureContext()?.drawElementImage).toHaveBeenCalledTimes(1);
    expect(win.__hf_page_composite_pending).toBe(false);
  });

  it("re-scans for movers when the runtime binds a different timeline", () => {
    installHtmlInCanvas();
    let timeline = "first";
    const h = { ...host(makeRoot()), timeline: () => timeline };
    initCaptureMotionBlur(h);
    const frame = (t: number): void => {
      void paintCaptureMotionBlur(t, PLAY);
      captureCanvas(h.root).dispatchEvent(new Event("paint"));
    };
    frame(0.5);
    const afterFirst = h.seek.mock.calls.length;
    frame(0.6);
    const steady = h.seek.mock.calls.length - afterFirst;
    timeline = "second";
    frame(0.7);
    // A scan seeks once per frame of the composition (30 here); a plain frame seeks far less.
    expect(h.seek.mock.calls.length - afterFirst - steady).toBeGreaterThan(steady + 30);
  });

  it("gives up on a frame whose paint never comes", async () => {
    vi.useFakeTimers();
    installHtmlInCanvas();
    initCaptureMotionBlur(movingHost().h);
    const done = paintCaptureMotionBlur(0.5, PLAY);
    let settled = false;
    void done?.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("rests on plain DOM in a hidden tab, with no paint requests, and resumes when visible (W1)", () => {
    installHtmlInCanvas();
    const requestPaint = vi.fn();
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = requestPaint;
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const visibility = (v: string) =>
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    visibility("hidden");
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(root.parentElement).toBe(document.body);
    expect(requestPaint).not.toHaveBeenCalled();
    void paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(root.parentElement).toBe(captureCanvas(root));
    visibility("visible");
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(root.parentElement).toBe(captureCanvas(root));
    expect(win.__hfMotionBlur?.report().state).toBe("on");
  });

  it("turns itself off and unwraps after repeated capture failures", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    for (let i = 0; i < 3; i++) {
      const done = paintCaptureMotionBlur(i / 30, PLAY);
      captureContext()?.drawElementImage.mockImplementation(() => {
        throw new Error("No cached paint record");
      });
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    }
    expect(root.parentElement).toBe(document.body);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "off" });
  });

  it("keeps blurring in a render after repeated capture failures, each failed frame plain DOM", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const engineFrame = async (i: number): Promise<void> => {
      const done = paintCaptureMotionBlur(i / 30, { engineMode: true });
      releaseCaptureMotionBlurFrame();
      captureCanvas(root).dispatchEvent(new Event("paint"));
      await done;
    };
    captureContext()?.drawElementImage.mockImplementation(() => {
      throw new Error("No cached paint record");
    });
    for (let i = 0; i < 5; i++) {
      await engineFrame(i);
      expect(root.parentElement).toBe(document.body);
    }
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 5 });
    captureContext()?.drawElementImage.mockReset();
    const done = paintCaptureMotionBlur(0.5, { engineMode: true });
    expect(captureCanvas(root).tagName).toBe("CANVAS");
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 0, frames: 6 });
    expect(contexts[1]?.drawImage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("device pixel ratio", () => {
  it("sizes the capture and output canvases in device pixels and keeps the CSS size", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 2);
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    const src = captureCanvas(root);
    const out = src.nextElementSibling as HTMLCanvasElement;
    for (const canvas of [src, out]) {
      expect([canvas.width, canvas.height]).toEqual([1280, 720]);
      expect([canvas.style.width, canvas.style.height]).toEqual(["640px", "360px"]);
    }
  });

  it("builds the accumulation buffer in device pixels", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 2);
    const sizes: number[][] = [];
    const Fake = (
      globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => object }
    ).OffscreenCanvas;
    vi.stubGlobal(
      "OffscreenCanvas",
      class extends Fake {
        constructor(w: number, h: number) {
          super(w, h);
          sizes.push([w, h]);
        }
      },
    );
    initCaptureMotionBlur(movingHost().h);
    expect(sizes[0]).toEqual([1280, 720]);
  });

  it("prefers the engine's injected scale over a devicePixelRatio that fell back to 1", () => {
    installHtmlInCanvas();
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("__HF_DEVICE_SCALE_FACTOR__", 2);
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    expect(captureCanvas(root).width).toBe(1280);
  });

  it("rebuilds the canvases when the ratio changes between frames", () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    const first = paintCaptureMotionBlur(0.5, PLAY);
    expect(captureCanvas(root).width).toBe(640);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    void first;
    vi.stubGlobal("devicePixelRatio", 2);
    void paintCaptureMotionBlur(0.6, PLAY);
    expect(captureCanvas(root).width).toBe(1280);
  });
});

describe("guards that once survived a deliberate break (T1)", () => {
  const frameOf = async (root: HTMLElement, t: number, fail: boolean): Promise<void> => {
    captureContext()?.drawElementImage.mockImplementation(() => {
      if (fail) throw new Error("No cached paint record");
    });
    const done = paintCaptureMotionBlur(t, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    captureCanvas(root).dispatchEvent(new Event("paint"));
    await done;
  };

  it("keeps blurring through two failed frames and gives up on exactly the third", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    await frameOf(root, 0.1, true);
    await frameOf(root, 0.2, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 2 });
    await frameOf(root, 0.3, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({
      state: "off",
      reason: "capture failed 3 times in a row",
    });
  });

  it("a good frame between failures restarts the count", async () => {
    installHtmlInCanvas();
    const { root, h } = movingHost();
    initCaptureMotionBlur(h);
    await frameOf(root, 0.1, true);
    await frameOf(root, 0.2, true);
    await frameOf(root, 0.3, false);
    await frameOf(root, 0.4, true);
    await frameOf(root, 0.5, true);
    expect(win.__hfMotionBlur?.report()).toMatchObject({ state: "on", failures: 2 });
  });

  it("never seeks below zero for the pose reads of a frame near the start", () => {
    installHtmlInCanvas();
    const { h } = movingHost();
    initCaptureMotionBlur(h);
    h.seek.mockClear();
    void paintCaptureMotionBlur(0.001, PLAY);
    void paintCaptureMotionBlur(0, { engineMode: true });
    const times = h.seek.mock.calls.map((call) => Number(call[0]));
    expect(times.length).toBeGreaterThan(4);
    expect(times.filter((t) => t < 0)).toEqual([]);
  });

  it("removes the hide rule and both canvases on unwrap, and the movers' hide attribute", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    const hideRules = () =>
      [...document.head.querySelectorAll("style")].filter((s) => s.textContent?.includes(HIDE));
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(hideRules()).toHaveLength(1);
    expect(el.hasAttribute(HIDE)).toBe(true);
    expect(paintCaptureMotionBlur(0.5)).toBeNull();
    expect(hideRules()).toHaveLength(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(el.hasAttribute(HIDE)).toBe(false);
    expect(root.parentElement).toBe(document.body);
  });

  it("does not blur a mover that is not visible", () => {
    installHtmlInCanvas();
    const { root, el, h } = movingHost();
    const visible = { value: false };
    const checkVisibility = vi.fn(() => visible.value);
    Object.defineProperty(el, "checkVisibility", { value: checkVisibility, configurable: true });
    initCaptureMotionBlur(h);
    void paintCaptureMotionBlur(0.5, PLAY);
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(checkVisibility).toHaveBeenCalledWith({ visibilityProperty: true });
    expect(el.hasAttribute(HIDE)).toBe(false);
    visible.value = true;
    void paintCaptureMotionBlur(0.6, { engineMode: true });
    releaseCaptureMotionBlurFrame();
    captureCanvas(root).dispatchEvent(new Event("paint"));
    expect(el.hasAttribute(HIDE)).toBe(true);
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
