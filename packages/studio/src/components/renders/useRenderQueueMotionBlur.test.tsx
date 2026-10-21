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

function stubHtmlInCanvas(members: string[]): void {
  vi.stubGlobal(
    "CanvasRenderingContext2D",
    class {
      drawElementImage(): void {}
    },
  );
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  for (const name of ["requestPaint", ...members]) proto[name] = () => {};
}

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  for (const name of ["requestPaint", "layoutSubtree", "updateElementGeometry"]) {
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)[name];
  }
  vi.unstubAllGlobals();
});

describe("render request previewMotionBlur", () => {
  it("is false in a browser without html-in-canvas", async () => {
    expect((await startRenderBody())["previewMotionBlur"]).toBe(false);
  });

  it.each([
    ["the layoutsubtree form", "layoutSubtree"],
    ["the content=drawable form", "updateElementGeometry"],
  ])("is true in a browser with html-in-canvas in %s", async (_name, member) => {
    stubHtmlInCanvas([member]);
    expect((await startRenderBody())["previewMotionBlur"]).toBe(true);
  });

  it("is false when html-in-canvas has neither known form", async () => {
    stubHtmlInCanvas([]);
    expect((await startRenderBody())["previewMotionBlur"]).toBe(false);
  });
});
