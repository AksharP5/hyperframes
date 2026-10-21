import { describe, expect, it, vi } from "vitest";
import {
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  acceleratedCanvasTrackerSource,
} from "@hyperframes/core";
import { installPageMotionBlur } from "./pageMotionBlur";

const fakePage = () => ({ evaluateOnNewDocument: vi.fn(async () => ({ identifier: "1" })) });

describe("installPageMotionBlur", () => {
  it("tells the page to stand down when the engine blurs", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { motionBlur: { samplesPerFrame: 16 } });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(2);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "engine-motion-blur",
    );
  });

  it("turns the page off when the Studio preview could not blur", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { pageMotionBlur: "off" });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "preview-unsupported",
    );
  });

  it("says why when the render route cannot host the blur", async () => {
    for (const route of ["hdr-render", "layered-composite", "distributed-render"] as const) {
      const page = fakePage();
      await installPageMotionBlur(page, { pageMotionBlur: route });
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.any(Function),
        PAGE_MOTION_BLUR_OFF_GLOBAL,
        route,
      );
    }
  });

  it("tells the page the render's device scale when it is not 1", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { deviceScaleFactor: 2 });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_DEVICE_SCALE_GLOBAL,
      2,
    );
  });

  it("installs the canvas tracker before any page script, and nothing else by default", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, {});
    expect(page.evaluateOnNewDocument.mock.calls).toEqual([[acceleratedCanvasTrackerSource()]]);
  });
});
