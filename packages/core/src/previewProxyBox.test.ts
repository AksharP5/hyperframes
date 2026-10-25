import { describe, expect, it } from "vitest";
import { parsePreviewProxyBox, quantizePreviewProxyBox } from "./previewProxyBox";

describe("preview proxy box", () => {
  it("rounds each side up to the next rung", () => {
    expect(quantizePreviewProxyBox(1080, 1920)).toEqual({ width: 1218, height: 2048 });
    expect(quantizePreviewProxyBox(1, 256)).toEqual({ width: 256, height: 256 });
  });

  it("keeps a 1080p stage's box within a fifth of the stage on each side", () => {
    expect(quantizePreviewProxyBox(1920, 1080)).toEqual({ width: 2048, height: 1218 });
    for (let side = 256; side <= 8192; side += 7) {
      const box = quantizePreviewProxyBox(side, side)!;
      expect(box.width).toBeGreaterThanOrEqual(side);
      expect(box.width / side).toBeLessThan(1.2);
    }
  });

  it("has no bound for an empty box or one past the largest rung", () => {
    expect(quantizePreviewProxyBox(0, 1920)).toBeNull();
    expect(quantizePreviewProxyBox(8193, 100)).toBeNull();
  });

  it("reads back only rungs", () => {
    expect(parsePreviewProxyBox("1448x2048")).toEqual({ width: 1448, height: 2048 });
    expect(parsePreviewProxyBox("1449x2048")).toBeNull();
    expect(parsePreviewProxyBox("1448x2048x1")).toBeNull();
    expect(parsePreviewProxyBox("")).toBeNull();
  });
});
