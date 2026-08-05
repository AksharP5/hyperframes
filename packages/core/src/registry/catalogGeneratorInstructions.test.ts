import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const generatorSource = readFileSync(join(repoRoot, "scripts/generate-catalog-pages.ts"), "utf-8");

describe("catalog generator texture instructions", () => {
  it("pins the unambiguous texture style-block copy instruction", () => {
    expect(generatorSource).toContain("paste the real <style> block");
    expect(generatorSource).toContain("near the bottom into the composition once");
    expect(generatorSource).toContain("real \\`<style>\\` element near the bottom");
  });
});

// docs/AGENTS.md requires every Catalog page to end with `## Related topics`.
// The generator emits it (see RELATED_TOPICS); this asserts the committed output
// still honours the rule, so a regeneration that drops it fails CI here.
describe("catalog pages keep the required reader continuation", () => {
  const catalogDir = join(repoRoot, "docs/catalog");
  const pages = (["blocks", "components"] as const).flatMap((sub) =>
    readdirSync(join(catalogDir, sub))
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => ({ sub, file: f, path: join(catalogDir, sub, f) })),
  );

  it("generates at least one page in each catalog subdirectory", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)("$sub/$file ends with a Related topics section", ({ path }) => {
    const body = readFileSync(path, "utf-8").trimEnd();
    const lastHeading = body
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .at(-1);
    expect(lastHeading).toBe("## Related topics");
  });
});
