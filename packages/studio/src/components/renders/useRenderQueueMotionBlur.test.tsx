// @vitest-environment happy-dom

// WYSIWYG: a render only blurs what the Studio preview could show, and only the browser knows
// whether it has html-in-canvas. The request body is how it tells the server.

import { afterEach, describe, expect, it, vi } from "vitest";
import { startRenderAndReadBody, type MountedQueue } from "./renderQueueTestHarness";

vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

let queue: MountedQueue | null = null;

async function startRenderBody(): Promise<Record<string, unknown>> {
  const started = await startRenderAndReadBody(useRenderQueue, {
    opts: { fps: 30, quality: "standard", format: "mp4" },
  });
  queue = started.queue;
  return started.body;
}

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint;
  vi.unstubAllGlobals();
});

describe("render request previewMotionBlur", () => {
  it("is false in a browser without html-in-canvas", async () => {
    expect((await startRenderBody())["previewMotionBlur"]).toBe(false);
  });

  it("is true in a browser with html-in-canvas", async () => {
    vi.stubGlobal(
      "CanvasRenderingContext2D",
      class {
        drawElementImage(): void {}
      },
    );
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).requestPaint = () => {};
    expect((await startRenderBody())["previewMotionBlur"]).toBe(true);
  });
});
