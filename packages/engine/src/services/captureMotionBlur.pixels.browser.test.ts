import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng } from "../utils/alphaBlit.js";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome } from "./__fixtures__/loopback.js";
import { waitForPendingSeekCompletion } from "./frameCapture.js";

const RUNTIME = resolve(import.meta.dirname, "../../../core/dist/hyperframe.runtime.iife.js");
const chromePath = resolveHeadlessShellPath();
const hasBrowser =
  chromePath !== undefined &&
  existsSync(RUNTIME) &&
  spawnSync(chromePath, ["--version"]).status === 0;

const W = 320;
const H = 180;
const FPS = 30;
/** One of the 16 taps is 255 / 16: a plateau may wobble by that much. */
const TAP = 16;

interface Frame {
  width: number;
  data: Uint8Array;
}
type Win = Window & {
  __player?: { renderSeek?: (t: number) => void };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_prepare?: () => Promise<boolean>;
  __hf_page_composite_resolve?: () => boolean;
  __hfMotionBlur?: { report: () => { state: string; reasonCode: string | null; movers: number } };
};

/** 40 px box moving 60 px per frame (1800 px over the 1 s composition). */
const STYLE = `
  @keyframes run { to { transform: translateX(1800px) } }
  @keyframes flip { to { transform: rotateY(180deg) } }
  @keyframes hide { from, to { backface-visibility: hidden } }
  @keyframes blink { 0%, 44% { backface-visibility: visible } 46%, 49% { backface-visibility: hidden } 51%, 100% { backface-visibility: visible } }
  .box { position: absolute; width: 40px; height: 40px; background: #f00; animation: run 1s linear both }
`;
const BOX = `<div class="box" id="box" style="left:20px;top:20px"></div>`;
const STRIPES = `<div id="stripes" style="position:absolute;left:200px;top:100px;width:40px;height:40px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div>`;
const CENTERED = `<div class="box" id="centered" style="left:50%;top:50%;translate:-50% -50%"></div>`;
const FLIP = `<div style="position:absolute;left:100px;top:40px;width:100px;height:100px;perspective:400px"><div id="card" style="width:100px;height:100px;background:#06c;backface-visibility:hidden;animation:flip 1s linear both"></div></div>`;

/** A card whose backface-visibility, if any, comes only from the given animation. */
const card = (animation: string, perspective = "perspective:400px") =>
  `<div style="position:absolute;left:100px;top:40px;width:100px;height:100px;${perspective}"><div id="card" style="width:100px;height:100px;background:#06c;${animation}"></div></div>`;
const WAAPI = `<script>document.getElementById("card").animate([{backfaceVisibility:"hidden"},{backfaceVisibility:"hidden"}],1000)</script>`;
const same = (a: Frame, b: Frame): boolean => Buffer.from(a.data).equals(Buffer.from(b.data));

function composition(body: string, blur: boolean): string {
  const attrs = blur ? ' data-motion-blur="on" data-motion-blur-shutter="360"' : "";
  return `<!doctype html><html><head><style>html,body{margin:0}${STYLE}</style></head><body>
    <div id="root" data-composition-id="root" data-start="0" data-duration="1" data-width="${W}" data-height="${H}"${attrs}
      style="position:relative;width:${W}px;height:${H}px;background:#fff;overflow:hidden">${body}</div></body></html>`;
}

const px = (f: Frame, x: number, y: number): [number, number, number] => {
  const i = (y * f.width + x) * 4;
  return [f.data[i] ?? 0, f.data[i + 1] ?? 0, f.data[i + 2] ?? 0];
};

/** How far a pixel is from white along white-to-red: 0 for white, 255 for pure red. */
const redness = (f: Frame, x: number, y: number): number => 255 - px(f, x, y)[1];

const row = (f: Frame, y: number): number[] =>
  Array.from({ length: W }, (_, x) => redness(f, x, y));

/** Columns that are neither the background nor the pure box colour. */
const intermediate = (values: number[]): number[] =>
  values.flatMap((v, x) => (v > 0 && v < 255 ? [x] : []));

/** Total redness: a blur spreads the box's ink along the path without adding or losing any. */
const ink = (values: number[]): number => values.reduce((s, v) => s + v, 0);

const centroid = (values: number[]): number => {
  const total = values.reduce((s, v) => s + v, 0);
  return values.reduce((s, v, x) => s + v * (x + 0.5), 0) / total;
};

describe.skipIf(!hasBrowser)("capture motion blur pixels in Chrome", () => {
  let browser: Browser;
  let supported = false;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-features=CanvasDrawElement"],
    });
    const probe = await browser.newPage();
    supported = await probe.evaluate(
      () =>
        typeof Reflect.get(CanvasRenderingContext2D.prototype, "drawElementImage") === "function",
    );
    await probe.close();
  }, 30_000);
  afterAll(() => closeTestChrome(browser));

  async function open(body: string, blur: boolean): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(composition(body, blur));
    await page.addScriptTag({ content: `window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:${FPS}};` });
    await page.addScriptTag({ content: readFileSync(RUNTIME, "utf8") });
    await page.waitForFunction(() => {
      const w = window as Win & { __playerReady?: boolean; __renderReady?: boolean };
      return w.__playerReady === true && w.__renderReady === true;
    });
    return page;
  }

  /** One frame the way the engine takes it: seek, wait for the page, composite, screenshot. */
  async function capture(page: Page, t: number): Promise<Frame> {
    const pending = await page.evaluate((time) => {
      const w = window as Win;
      w.__player?.renderSeek?.(time);
      return w.__hf_page_composite_pending === true;
    }, t);
    await waitForPendingSeekCompletion(page);
    if (pending) {
      await page.evaluate(async () => {
        const w = window as Win;
        await w.__hf_page_composite_prepare?.();
      });
      const cdp = await page.createCDPSession();
      await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 1,
        clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
      });
      await cdp.detach();
      await page.evaluate(() => (window as Win).__hf_page_composite_resolve?.());
    }
    const png = Buffer.from(await page.screenshot({ type: "png" }));
    const { width, data } = decodePng(png);
    return { width, data };
  }

  async function frameOf(body: string, blur: boolean, t: number) {
    const page = await open(body, blur);
    try {
      const frame = await capture(page, t);
      const report = await page.evaluate(() => (window as Win).__hfMotionBlur?.report() ?? null);
      return { frame, report };
    } finally {
      await page.close();
    }
  }

  const FRAME = 2 / FPS;

  it("leaves a trail along the motion line where the sharp frame has hard edges", async (ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(BOX, true, FRAME);
    const sharp = await frameOf(BOX, false, FRAME);
    expect(blurred.report).toMatchObject({ state: "on", movers: 1 });

    const sharpRow = row(sharp.frame, 40);
    expect(sharpRow.filter((v) => v === 255)).toHaveLength(40);
    expect(intermediate(sharpRow)).toEqual([]);

    const trail = row(blurred.frame, 40);
    const span = intermediate(trail);
    expect(span.length).toBeGreaterThanOrEqual(40);
    const [first = 0] = span;
    const last = span[span.length - 1] ?? 0;
    expect(first).toBeLessThan(140);
    expect(last).toBeGreaterThan(180);
    const rising = trail.slice(first, 150);
    const falling = trail.slice(170, last + 1);
    expect(rising.every((v, i) => i === 0 || v >= (rising[i - 1] ?? 0) - TAP)).toBe(true);
    expect(falling.every((v, i) => i === 0 || v <= (falling[i - 1] ?? 0) + TAP)).toBe(true);
    expect(Math.max(...trail)).toBeGreaterThan(120);
    expect(Math.abs(centroid(trail) - 160)).toBeLessThan(0.5);
    expect(ink(trail) / ink(sharpRow)).toBeGreaterThan(0.97);
    expect(ink(trail) / ink(sharpRow)).toBeLessThan(1.03);
  });

  it("leaves what does not move exactly as the sharp frame has it", async (ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(BOX + STRIPES, true, FRAME);
    const sharp = await frameOf(BOX + STRIPES, false, FRAME);
    expect(blurred.report).toMatchObject({ state: "on" });
    let differing = 0;
    for (let y = 100; y < 140; y++) {
      for (let x = 200; x < 240; x++) {
        if (px(blurred.frame, x, y).join() !== px(sharp.frame, x, y).join()) differing++;
      }
    }
    expect(differing).toBe(0);
    expect(new Set(Array.from({ length: 40 }, (_, x) => px(sharp.frame, 200 + x, 110)[0]))).toEqual(
      new Set([0, 255]),
    );
  });

  it("blurs a box centred with translate around where it really is", async (ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(CENTERED, true, 1 / FPS);
    const sharp = await frameOf(CENTERED, false, 1 / FPS);
    const trail = row(blurred.frame, 90);
    expect(intermediate(trail).length).toBeGreaterThanOrEqual(40);
    const trueCentre = centroid(row(sharp.frame, 90));
    expect(trueCentre).toBeCloseTo(220, 0);
    expect(Math.abs(centroid(trail) - trueCentre)).toBeLessThan(0.5);
    const column = Array.from({ length: H }, (_, y) => redness(blurred.frame, 220, y));
    expect(Math.abs(centroid(column) - 90)).toBeLessThan(0.5);
  });

  it("blocks a backface-hidden card in a 3D flip and renders the plain frame", async (ctx) => {
    if (!supported) ctx.skip();
    const blurred = await frameOf(FLIP, true, 0.4);
    const sharp = await frameOf(FLIP, false, 0.4);
    expect(blurred.report).toMatchObject({ state: "off", reasonCode: "backface-visibility" });
    expect(Buffer.from(blurred.frame.data).equals(Buffer.from(sharp.frame.data))).toBe(true);
  });

  it("blocks a face whose backface-visibility only arrives through animation", async (ctx) => {
    if (!supported) ctx.skip();
    const sharp = await frameOf(BOX + card(""), false, 0.4);
    for (const body of [BOX + card("animation: hide 1s both"), BOX + card("") + WAAPI]) {
      const blurred = await frameOf(body, true, 0.4);
      expect(blurred.report).toMatchObject({ state: "off", reasonCode: "backface-visibility" });
      expect(same(blurred.frame, sharp.frame)).toBe(true);
    }
  });

  it("renders only the frame plain where an animated face flips between scan samples", async (ctx) => {
    if (!supported) ctx.skip();
    const slow = BOX.replace("top:20px", "top:20px;animation-duration:6s");
    const body = slow + card("animation: blink 1s both");
    for (const [frame, plain] of [
      [14, true],
      [5, false],
    ] as const) {
      const t = frame / FPS;
      const [blurred, sharp] = [await frameOf(body, true, t), await frameOf(body, false, t)];
      expect(blurred.report).toMatchObject({ state: "on" });
      expect(same(blurred.frame, sharp.frame)).toBe(plain);
    }
  });

  it("leaves a flat animated backface-visibility hack blurred", async (ctx) => {
    if (!supported) ctx.skip();
    const { report } = await frameOf(BOX + card("animation: hide 1s both", ""), true, 0.4);
    expect(report).toMatchObject({ state: "on", movers: 1 });
  });
});
