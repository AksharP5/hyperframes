/**
 * Capture motion blur, in preview and render. Root attributes: data-motion-blur="on"|"off",
 * -shutter (0–720°, default 180), -samples (2–64, default 16), -events="on" (run timeline
 * callbacks at sub-frame samples). PAGE_MOTION_BLUR_OFF_GLOBAL (engine blur, or a preview that
 * could not blur) turns all off.
 *
 * Per frame: read movers' poses across the shutter (seeks, no paint), capture the root and crop
 * the movers, hide them and capture the background, then redraw each along its path.
 * The root is wrapped, not its children (author selectors keep matching), and only while playing
 * or rendering with something moving: paused, it is plain DOM so Studio can select inside it.
 * Needs html-in-canvas (`drawElementImage`); without it nothing changes.
 */

import {
  htmlInCanvasForm,
  markCaptureCanvas,
  markCaptured,
  unmarkCaptured,
  type HtmlInCanvasForm,
} from "../../htmlInCanvas";
import {
  type CaptureDefect,
  type DefectEnv,
  chromeMajor,
  createDefectScan,
  findCaptureDefect,
  scanBackfaceDefect,
} from "../../htmlInCanvasDefects";
import {
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  installAcceleratedCanvasTracker,
  isAcceleratedCanvas,
  supportsCaptureMotionBlur,
} from "../../pageMotionBlur";
import { swallow } from "../diagnostics";
import { createCompositor, type MoverFrame } from "./composite";
import { discoverMovers } from "./discover";
import { type Affine, createPoseReader, IDENTITY, tapsFromReads } from "./pose";

export interface CaptureMotionBlurHost {
  root: HTMLElement;
  fps: number;
  durationSeconds: () => number;
  /** The bound root timeline; movers are re-scanned when it changes. */
  timeline: () => unknown;
  now: () => number;
  /** Seek the timeline and adapters (not media) for a pose read. */
  seek: (t: number, suppressEvents: boolean) => void;
  ignoreMutations?: (write: () => void) => void;
}

interface Config {
  shutterDeg: number;
  samples: number;
  events: boolean;
}

interface Report {
  state: "on" | "off";
  reason: string | null;
  reasonCode: string | null;
  movers: number;
  /** The blurred elements, as `tag#id.class`, for diagnosing what was (not) picked. */
  moverNames: string[];
  /** One-time cost of finding the movers, in ms. */
  scanMs: number;
  shutterDeg: number;
  frames: number;
  meanMs: number;
  failures: number;
  failedFrames: number;
}

type DrawElementContext = CanvasRenderingContext2D & {
  drawElementImage: (el: Element, x: number, y: number) => unknown;
};
type PaintCanvas = HTMLCanvasElement & { requestPaint: () => void };
type CompositeWindow = Window & {
  __hfMotionBlur?: { report: () => Report; probe: () => Report; suspend: () => void };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
};

/** Marks a mover hidden for the background capture; set only between a frame's two paints. */
const HIDE_ATTR = "data-hf-motion-blur-hide";

interface Job {
  seq: number;
  els: HTMLElement[];
  frames: MoverFrame[];
  /** Which movers were cropped (null until the first capture of this frame). */
  kept: boolean[] | null;
  /** Engine frames wait for a release: video frames are injected after the seek. */
  armed: boolean;
  /** The paint wait starts on arming, so slow video injection cannot time a frame out unseen. */
  startTimer: () => void;
  ms: number;
  settle: () => void;
}

/** Pose reads per frame; the taps between them are interpolated. A render reads more. */
const PREVIEW_READS = 4;
const RENDER_READS = 8;
/** Same ceiling as vfx: a real paint is two animation frames. */
const PAINT_TIMEOUT_MS = 2000;
/** Consecutive capture failures before the blur turns itself off for the session. */
const MAX_FAILURES = 3;
const LOG_EVERY = 25;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function readConfig(root: HTMLElement): Config | null {
  if (root.getAttribute("data-motion-blur") !== "on") return null;
  const num = (name: string, fallback: number): number => {
    const v = Number(root.getAttribute(name));
    return root.hasAttribute(name) && Number.isFinite(v) ? v : fallback;
  };
  return {
    shutterDeg: clamp(num("data-motion-blur-shutter", 180), 0, 720),
    samples: Math.round(clamp(num("data-motion-blur-samples", 16), 2, 64)),
    events: root.getAttribute("data-motion-blur-events") === "on",
  };
}

/** Must run before composition scripts: see `installAcceleratedCanvasTracker`. */
export const trackAcceleratedCanvases = installAcceleratedCanvasTracker;

const isAccelerated: DefectEnv["isAccelerated"] = isAcceleratedCanvas;

function unsupported(root: HTMLElement): CaptureDefect | null {
  const off = (window as unknown as Record<string, unknown>)[PAGE_MOTION_BLUR_OFF_GLOBAL];
  if (off) return { code: "renderer-off", reason: `the renderer turned it off (${String(off)})` };
  if (!supportsCaptureMotionBlur()) {
    return {
      code: "unsupported-browser",
      reason: "html-in-canvas (drawElementImage) is unavailable in this browser",
    };
  }
  return findCaptureDefect(root, { isAccelerated, backface: scanBackfaceDefect(root) });
}

function describe(el: Element): string {
  const cls =
    typeof el.className === "string" && el.className
      ? `.${el.className.trim().split(/\s+/).join(".")}`
      : "";
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}`;
}

function rootSize(root: HTMLElement): { width: number; height: number } {
  const w = Number(root.getAttribute("data-width")) || root.offsetWidth;
  const h = Number(root.getAttribute("data-height")) || root.offsetHeight;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

function readDpr(): number {
  const injected = Number((window as unknown as Record<string, unknown>)[PAGE_DEVICE_SCALE_GLOBAL]);
  const dpr = injected > 0 ? injected : window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function makeCanvas(width: number, height: number, role: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * readDpr()));
  canvas.height = Math.max(1, Math.round(height * readDpr()));
  canvas.setAttribute("data-hf-ignore", "");
  canvas.setAttribute("data-hf-motion-blur", role);
  // ponytail: assumes the root sits at its parent's origin (true for compositions); place the
  // canvases at the root's offset if a layout ever puts it elsewhere.
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;`;
  return canvas;
}

function createInstance(host: CaptureMotionBlurHost, config: Config, form: HtmlInCanvasForm) {
  const { root } = host;
  const { width, height } = rootSize(root);
  const src = makeCanvas(width, height, "capture") as PaintCanvas;
  const out = makeCanvas(width, height, "output");
  out.style.pointerEvents = "none";
  markCaptureCanvas(src, form);

  const captureContext = src.getContext("2d") as DrawElementContext | null;
  const outputContext = out.getContext("2d");
  if (!captureContext || !outputContext) throw new Error("capture motion blur: no 2D context");
  const sctx: DrawElementContext = captureContext;
  const octx: CanvasRenderingContext2D = outputContext;
  let dpr = readDpr();
  let compositor = createCompositor(width, height, dpr);
  // Hides movers for the background capture without touching author or GSAP opacity.
  const hideRule = document.createElement("style");
  hideRule.setAttribute("data-hf-ignore", "");
  hideRule.textContent = `[${HIDE_ATTR}] { opacity: 0 !important; }`;

  let movers: HTMLElement[] = [];
  let reader: ReturnType<typeof createPoseReader> | null = null;
  let pending: Job | null = null;
  // While a frame is in flight (two paints), newer requests collapse into the latest one.
  let queued: { t: number; engineMode: boolean; release: () => void } | null = null;
  let seq = 0;
  let failures = 0;
  let failedFrames = 0;
  let disabled: string | null = null;
  let disabledCode: string | null = null;
  // Capture failures end blur for good; a defect block lasts until the scene is scanned again.
  let failedForGood = false;
  const timings: number[] = [];
  let sampleMs = 0;
  let scanMs = 0;
  let scannedTimeline: unknown = undefined;
  let scanDefect: CaptureDefect | null = null;
  let faceNow: () => boolean = () => false;
  const loggedBackstops = new Set<string>();
  let wrapped = false;
  // The output still shows the last frame of the previous wrap until this one draws.
  let staleOutput = false;
  // Once the engine drives frames, paused-style requests come from the transport, not a user.
  let rendering = false;

  function moveRootThenResync(move: () => void): void {
    (host.ignoreMutations ?? ((write: () => void) => write()))(move);
    host.seek(host.now(), true);
  }

  function wrap(): void {
    if (wrapped) return;
    moveRootThenResync(() => {
      root.before(src);
      src.append(root);
      markCaptured(root, form);
      src.after(out);
      document.head.append(hideRule);
    });
    wrapped = true;
    staleOutput = true;
  }

  /** Back to plain DOM: drop any frame in flight, put the root where it was. */
  function unwrap(): void {
    queued?.release();
    queued = null;
    if (pending) {
      reveal(pending);
      pending.settle();
      pending = null;
    }
    if (!wrapped) return;
    wrapped = false;
    moveRootThenResync(() => {
      hideRule.remove();
      unmarkCaptured(root, form);
      src.before(root);
      src.remove();
      out.remove();
    });
  }

  const seek = (t: number): void => host.seek(t, !config.events);
  // The scan walks the whole timeline: callbacks must not fire (or leave their effects) there.
  const scanSeek = (t: number): void => host.seek(t, true);

  function discover(restoreTo: number): void {
    scannedTimeline = host.timeline();
    const duration = host.durationSeconds();
    const defects = createDefectScan(root, isAccelerated);
    const s0 = performance.now();
    const found = discoverMovers({
      scene: root,
      durationSeconds: duration,
      fps: host.fps,
      seek: scanSeek,
      onStep: (i, steps) => defects.sample(i, steps, (i / steps) * duration),
    });
    scanSeek(restoreTo);
    scanDefect = defects.result();
    faceNow = defects.facesNow;
    movers = found.movers;
    reader = createPoseReader(root, found.dynamic);
    scanMs = Math.round(performance.now() - s0);
  }

  function frames(t: number, reads: number): { els: HTMLElement[]; frames: MoverFrame[] } {
    const r = reader;
    if (!r) return { els: [], frames: [] };
    const visible = movers.filter(
      (el) =>
        typeof el.checkVisibility !== "function" ||
        el.checkVisibility({ visibilityProperty: true }),
    );
    const shutter = config.shutterDeg / 360 / host.fps;
    if (visible.length === 0 || shutter <= 0) return { els: [], frames: [] };
    const start = t - shutter / 2;
    const poses = visible.map((): Affine[] => []);
    for (let j = 0; j < reads; j++) {
      seek(Math.max(0, start + (j / (reads - 1)) * shutter));
      r.reset();
      visible.forEach((el, i) => poses[i]?.push(r.pose(el)));
    }
    seek(t);
    r.reset();
    const result = visible.map((el, i) => ({
      w: el.offsetWidth,
      h: el.offsetHeight,
      now: r.pose(el),
      taps: tapsFromReads(poses[i] ?? [IDENTITY], config.samples),
    }));
    r.reset();
    return { els: visible, frames: result };
  }

  const capture = (): void => {
    sctx.reset();
    sctx.drawElementImage(root, 0, 0);
  };
  const reveal = (job: Job): void => {
    for (const el of job.els) el.removeAttribute(HIDE_ATTR);
  };

  /**
   * One step of the current frame, run on each paint (or by the engine's composite hook):
   * first capture the movers and crop their pixels, then hide them and, on the next paint,
   * capture the background and draw it with the trails. A frame with nothing moving is done
   * after the first capture. `finalStep` forces the frame to finish now (no further paint will
   * come), drawing trails over the sharp frame if the background was never captured.
   */
  function step(finalStep = false): void {
    const job = pending;
    if (!job || disabled || !job.armed) return;
    const t0 = performance.now();
    let done = true;
    try {
      done = captureAndDraw(job, finalStep);
      failures = 0;
    } catch (err) {
      onCaptureFailure(err);
    }
    job.ms += performance.now() - t0;
    if (!done && !disabled) {
      src.requestPaint();
      return;
    }
    timings.push(sampleMs + job.ms);
    if (timings.length > 600) timings.shift();
    finishJob(job);
  }

  function onCaptureFailure(err: unknown): void {
    failures++;
    swallow("runtime.captureMotionBlur.compose", err);
    countFailedFrame(err instanceof Error ? err.message : String(err));
    // A render never gives up mid-video: this frame shows the plain DOM, the next wraps again.
    if (rendering) unwrap();
    else if (failures >= MAX_FAILURES)
      disable(`capture failed ${failures} times in a row`, "capture-failures", true);
  }

  /** This paint's half of the frame; false when the background capture is still to come. */
  function captureAndDraw(job: Job, finalStep: boolean): boolean {
    capture();
    try {
      if (!job.kept) {
        job.kept = compositor.crop(src, job.frames);
        if (staleOutput) {
          // First paint since wrapping: show this frame sharp until its trails are drawn.
          octx.setTransform(1, 0, 0, 1, 0, 0);
          octx.globalAlpha = 1;
          octx.globalCompositeOperation = "copy";
          octx.drawImage(src, 0, 0);
          staleOutput = false;
        }
        if (job.kept.some(Boolean) && !finalStep) {
          job.els.forEach((el, i) => job.kept?.[i] && el.setAttribute(HIDE_ATTR, ""));
          return false;
        }
      }
      compositor.draw(src, octx, job.frames, job.kept);
      return true;
    } finally {
      sctx.reset(); // the capture canvas sits under the output: keep its own bitmap empty
    }
  }

  /** End a frame (drawn or given up on) and start the newest frame requested meanwhile. */
  function finishJob(job: Job): void {
    reveal(job);
    if (pending === job) pending = null;
    job.settle();
    const next = queued;
    queued = null;
    if (next && !disabled) void start(next.t, next.engineMode).then(next.release);
    else next?.release();
  }
  const onPaint = (): void => step();

  function countFailedFrame(why: string): void {
    failedFrames++;
    if (failedFrames % LOG_EVERY === 1)
      console.info(`[motion-blur] capture failed (${failedFrames} so far): ${why}`);
  }

  // A tab that stops painting while the clock runs is not a broken capture: this frame is plain
  // DOM (root back in the page, movers revealed), the next tries again, and timeouts never count
  // toward giving up.
  function onPaintTimeout(job: Job): void {
    countFailedFrame(`no paint within ${PAINT_TIMEOUT_MS} ms`);
    unwrap();
    finishJob(job);
  }

  src.addEventListener("paint", onPaint);

  function disable(reason: string, code: string, forGood = false): void {
    if (disabled) return;
    disabled = reason;
    disabledCode = code;
    failedForGood = forGood;
    console.warn(`[motion-blur] off: ${reason}`);
    teardown();
  }

  function teardown(): void {
    src.removeEventListener("paint", onPaint);
    unwrap();
  }

  function clearDefectBlock(): void {
    if (!disabled || failedForGood) return;
    disabled = null;
    disabledCode = null;
    reader = null;
    src.addEventListener("paint", onPaint);
  }

  function releaseStaleBlock(): void {
    if (disabled && host.timeline() !== scannedTimeline) clearDefectBlock();
  }

  /**
   * Request one blurred frame at `t`; resolves once it is drawn (or given up on). A frame still
   * in flight (between its two paints) is not abandoned: the request waits as the newest pending
   * one. An engine frame replaces it, since the engine waits on exactly this frame.
   */
  function paint(t: number, engineMode: boolean): Promise<void> {
    releaseStaleBlock();
    if (disabled) return Promise.resolve();
    if (engineMode) rendering = true;
    // A hidden tab paints nothing: rest on plain DOM instead of waiting on paints that never come.
    if (!rendering && document.visibilityState === "hidden") {
      unwrap();
      return Promise.resolve();
    }
    if (pending && !engineMode) {
      const previous = queued;
      return new Promise<void>((resolve) => {
        queued = {
          t,
          engineMode,
          release: () => {
            previous?.release();
            resolve();
          },
        };
      });
    }
    return start(t, engineMode);
  }

  function syncDensity(): void {
    const next = readDpr();
    if (next === dpr) return;
    dpr = next;
    for (const canvas of [src, out]) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    compositor = createCompositor(width, height, dpr);
    staleOutput = true;
  }

  /** Scan when the timeline is new; true when the scan found a defect (blur is then off). */
  function blockedByScan(t: number): boolean {
    if (!reader || host.timeline() !== scannedTimeline) discover(t);
    if (scanDefect) disable(scanDefect.reason, scanDefect.code);
    return disabled !== null;
  }

  /** The scan decided the timeline; a defect it missed makes this one frame sharp. */
  function plainFrame(defect: CaptureDefect): Promise<void> {
    unwrap();
    failedFrames++;
    if (!loggedBackstops.has(defect.code)) {
      loggedBackstops.add(defect.code);
      console.info(`[motion-blur] sharp frame: ${defect.code} appeared after a clean scan`);
    }
    return Promise.resolve();
  }

  function start(t: number, engineMode: boolean): Promise<void> {
    try {
      syncDensity();
      if (blockedByScan(t)) return Promise.resolve();
      if (movers.length === 0) {
        unwrap();
        return Promise.resolve();
      }
      const late = findCaptureDefect(root, { isAccelerated, backface: faceNow() });
      if (late) return plainFrame(late);
      wrap();
      const s0 = performance.now();
      const next = frames(t, engineMode ? RENDER_READS : PREVIEW_READS);
      sampleMs = performance.now() - s0;
      if (pending) finishJob(pending);
      return new Promise<void>((resolve) => {
        const mine = ++seq;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const startTimer = (): void => {
          timer = setTimeout(() => {
            if (pending?.seq === mine) onPaintTimeout(pending);
            else resolve();
          }, PAINT_TIMEOUT_MS);
        };
        pending = {
          seq: mine,
          els: next.els,
          frames: next.frames,
          kept: null,
          armed: !engineMode,
          startTimer,
          ms: 0,
          settle: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        if (engineMode) return;
        startTimer();
        src.requestPaint();
      });
    } catch (err) {
      swallow("runtime.captureMotionBlur.paint", err);
      disable(err instanceof Error ? err.message : String(err), "capture-failures", true);
      return Promise.resolve();
    }
  }

  function report(): Report {
    const mean = timings.length ? timings.reduce((s, x) => s + x, 0) / timings.length : 0;
    return {
      state: disabled ? "off" : "on",
      reason: disabled,
      reasonCode: disabledCode,
      movers: movers.length,
      moverNames: movers.map(describe),
      scanMs,
      shutterDeg: config.shutterDeg,
      frames: timings.length,
      meanMs: Math.round(mean * 10) / 10,
      failures,
      failedFrames,
    };
  }

  function probe(): Report {
    releaseStaleBlock();
    if (!disabled) blockedByScan(host.now());
    return report();
  }

  return {
    root,
    paint,
    probe,
    /** Paused in preview: show plain DOM so it can be selected. A render never rests. */
    rest: (): boolean => {
      if (rendering) return false;
      unwrap();
      return true;
    },
    arm: () => {
      if (!pending || pending.armed) return;
      pending.armed = true;
      pending.startTimer();
      src.requestPaint();
    },
    /** Finish the current frame now: the engine's forced paint just ran. */
    finish: () => {
      if (pending) pending.armed = true;
      step(true);
    },
    teardown,
    suspend: unwrap,
    report,
    busy: (): boolean => pending !== null,
    rediscover: () => {
      reader = null;
      clearDefectBlock();
    },
  };
}

type Instance = ReturnType<typeof createInstance>;
let instance: Instance | null = null;
let suspended = false;
let priorResolver: (() => boolean) | null = null;
let ourResolver: (() => boolean) | null = null;

/**
 * Read the root's opt-in and wrap (or unwrap) it. Called wherever the runtime (re)initialises
 * scene DOM; a repeat call on the same root only schedules a fresh mover scan.
 */
export function initCaptureMotionBlur(host: CaptureMotionBlurHost): void {
  const config = readConfig(host.root);
  const w = window as CompositeWindow;
  if (instance && (instance.root !== host.root || !config)) {
    instance.teardown();
    instance = null;
    delete w.__hfMotionBlur;
  }
  if (!config) return;
  if (instance) {
    instance.rediscover();
    return;
  }
  const form = htmlInCanvasForm();
  const why = unsupported(host.root);
  if (!form || why) {
    const reason = why?.reason ?? null;
    console.info(`[motion-blur] off: ${reason} (Chrome ${chromeMajor() ?? "unknown"})`);
    const report = (): Report => ({
      state: "off",
      reason,
      reasonCode: why?.code ?? null,
      movers: 0,
      moverNames: [],
      scanMs: 0,
      shutterDeg: config.shutterDeg,
      frames: 0,
      meanMs: 0,
      failures: 0,
      failedFrames: 0,
    });
    w.__hfMotionBlur = { report, probe: report, suspend: suspendCaptureMotionBlur };
    return;
  }
  instance = createInstance(host, config, form);
  const current = instance;
  w.__hfMotionBlur = {
    report: () => current.report(),
    probe: () => current.probe(),
    suspend: suspendCaptureMotionBlur,
  };
}

/**
 * Draw the blurred frame for `t` after a seek or a playback tick. In preview only playback blurs:
 * a paused request (no `playing`) unwraps the composition instead and returns null. In engine
 * mode it also claims the engine's
 * page-composite step, composing with whoever already holds it, so a render frame is complete
 * before the screenshot even if no paint event fired. Returns the frame's completion.
 */
export function paintCaptureMotionBlur(
  t: number,
  options?: { engineMode?: boolean; playing?: boolean },
): Promise<void> | null {
  if (!instance || suspended) return null;
  const engineMode = options?.engineMode === true;
  if (!engineMode && !options?.playing && instance.rest()) return null;
  const done = instance.paint(t, engineMode);
  // Nothing in flight (nothing moves, or blur turned off): leave the engine's composite step idle.
  if (engineMode && instance.busy()) armPageComposite();
  return done;
}

/** True while a blurred frame is between its two captures: the page must hold still. */
export function captureMotionBlurBusy(): boolean {
  return instance?.busy() ?? false;
}

/** Start capturing a deferred engine frame: the page (injected video frames included) is final. */
export function releaseCaptureMotionBlurFrame(): void {
  instance?.arm();
}

function armPageComposite(): void {
  const w = window as CompositeWindow;
  const current = w.__hf_page_composite_resolve;
  if (current !== ourResolver) {
    priorResolver = typeof current === "function" ? current : null;
    ourResolver = () => {
      if (priorResolver) priorResolver();
      // The engine's forced paint has just run, so the paint records are valid here even if
      // no paint event reached us; compose() is a no-op when the event already drew the frame.
      instance?.finish();
      w.__hf_page_composite_pending = false;
      return true;
    };
    w.__hf_page_composite_resolve = ourResolver;
  }
  w.__hf_page_composite_pending = true;
}

/** Stop wrapping and painting for the rest of the page's life; the reported decision stays. */
function suspendCaptureMotionBlur(): void {
  suspended = true;
  instance?.suspend();
}

/** Test-only: drop module state between cases. */
export function resetCaptureMotionBlurForTests(): void {
  instance?.teardown();
  instance = null;
  suspended = false;
  priorResolver = null;
  ourResolver = null;
}
