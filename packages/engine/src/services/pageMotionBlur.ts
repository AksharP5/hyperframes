/**
 * Tells the page's capture motion blur (`data-motion-blur="on"`) to stand down, before any of
 * its scripts run: when the engine blurs (it would average frames that are already blurred) or
 * when the render must match a Studio preview that could not blur (`pageMotionBlur: "off"`).
 */

import {
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  acceleratedCanvasTrackerSource,
} from "@hyperframes/core";
import type { Page } from "puppeteer-core";
import type { CaptureOptions } from "../types.js";

function pageOffReason(
  options: Pick<CaptureOptions, "motionBlur" | "pageMotionBlur">,
): string | null {
  if (options.motionBlur) return "engine-motion-blur";
  if (options.pageMotionBlur === "off") return "preview-unsupported";
  return options.pageMotionBlur ?? null;
}

export async function installPageMotionBlur(
  page: Pick<Page, "evaluateOnNewDocument">,
  options: Pick<CaptureOptions, "motionBlur" | "pageMotionBlur" | "deviceScaleFactor">,
): Promise<void> {
  await page.evaluateOnNewDocument(acceleratedCanvasTrackerSource());
  const scale = options.deviceScaleFactor ?? 1;
  if (scale > 1) {
    await page.evaluateOnNewDocument(
      (key: string, v: number) => {
        (window as unknown as Record<string, unknown>)[key] = v;
      },
      PAGE_DEVICE_SCALE_GLOBAL,
      scale,
    );
  }
  const off = pageOffReason(options);
  if (!off) return;
  await page.evaluateOnNewDocument(
    (key: string, v: string) => {
      (window as unknown as Record<string, unknown>)[key] = v;
    },
    PAGE_MOTION_BLUR_OFF_GLOBAL,
    off,
  );
}
