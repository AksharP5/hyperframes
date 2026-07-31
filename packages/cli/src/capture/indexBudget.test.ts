import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");

describe("website capture post-navigation budget", () => {
  it("bounds the lazy-load scroll loop by the shared remaining budget", () => {
    expect(source).toContain("const lazyLoadBudgetMs = Math.min(15_000, remainingMs());");
    expect(source).toContain("var lazyLoadDeadline = Date.now() + ${lazyLoadBudgetMs};");
    expect(source).toContain("if (Date.now() >= lazyLoadDeadline) break;");
  });
});
