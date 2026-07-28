import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import {
  detectGpuBackend,
  detectSwiftShader,
  resolveDrawElementCaptureMode,
} from "./drawElementService.js";

// ── detectGpuBackend / detectSwiftShader ───────────────────────────────────────

describe("detectGpuBackend", () => {
  function makePage(evaluateResult: unknown): Page {
    return {
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
    } as unknown as Page;
  }

  it("carries the raw renderer string alongside the SwiftShader verdict", async () => {
    const page = makePage({
      isSwiftShader: false,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
    expect(await detectGpuBackend(page)).toEqual({
      isSwiftShader: false,
      renderer: "ANGLE (NVIDIA, D3D11 vs_5_0 ps_5_0, D3D11)",
    });
  });

  it("reports null renderer when WebGL is unavailable", async () => {
    const page = makePage({ isSwiftShader: false, renderer: null });
    expect(await detectGpuBackend(page)).toEqual({ isSwiftShader: false, renderer: null });
  });

  it("detectSwiftShader wrapper returns true when renderer is SwiftShader", async () => {
    const page = makePage({ isSwiftShader: true, renderer: "Google SwiftShader" });
    expect(await detectSwiftShader(page)).toBe(true);
  });

  it("detectSwiftShader wrapper returns false for a hardware renderer", async () => {
    const page = makePage({ isSwiftShader: false, renderer: "ANGLE (Apple, ANGLE Metal)" });
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("passes a function to page.evaluate", async () => {
    const page = makePage({ isSwiftShader: false, renderer: null });
    await detectGpuBackend(page);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ── resolveDrawElementCaptureMode ──────────────────────────────────────────────

describe("resolveDrawElementCaptureMode", () => {
  // signature: (isSwiftShader, transparent)
  it("opaque + SwiftShader → screenshot (no GPU egress to skip — parity at best)", () => {
    expect(resolveDrawElementCaptureMode(true, false)).toBe("screenshot");
  });

  it("transparent + SwiftShader → screenshot (also drops sub-layers; crbug 521434899)", () => {
    expect(resolveDrawElementCaptureMode(true, true)).toBe("screenshot");
  });

  it("transparent + GPU → drawelement (GPU handles transparent correctly)", () => {
    expect(resolveDrawElementCaptureMode(false, true)).toBe("drawelement");
  });

  it("opaque + GPU → drawelement", () => {
    expect(resolveDrawElementCaptureMode(false, false)).toBe("drawelement");
  });

  // The <video> gate (proxy for the caption-pattern bug, crbug 521861819) was
  // removed once Chrome 151 fixed it — video comps now take the drawElement path.
});
