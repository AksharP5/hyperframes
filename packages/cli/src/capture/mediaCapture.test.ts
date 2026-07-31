import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { remainingVideoDownloadTimeoutMs } from "./mediaCapture.js";

const source = readFileSync(new URL("./mediaCapture.ts", import.meta.url), "utf-8");

describe("remainingVideoDownloadTimeoutMs", () => {
  it("caps a video request to the remaining capture budget", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 4_500)).toBe(1_500);
  });

  it("returns zero after the aggregate budget is exhausted", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 6_001)).toBe(0);
  });

  it("retains the existing per-request ceiling when more budget remains", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 300_000, 2_000)).toBe(120_000);
  });

  it("checks the aggregate budget before starting each preview/download iteration", () => {
    expect(source).toContain(
      "if (remainingVideoDownloadTimeoutMs(dlStart, downloadBudgetMs) <= 0) break;",
    );
  });
});
