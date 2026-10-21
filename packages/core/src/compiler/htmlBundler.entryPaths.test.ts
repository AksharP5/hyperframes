// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

const checked = vi.hoisted(() => [] as string[]);

vi.mock("../safePath.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safePath.js")>();
  return {
    ...actual,
    isSafePath: (base: string, resolved: string) => {
      checked.push(resolved);
      return actual.isSafePath(base, resolved);
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "hf-bundle-entry-paths-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("checks each project path once per build, however many times a sub-composition is mounted", async () => {
  mkdirSync(join(dir, "compositions"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.png"), "png");
  writeFileSync(join(dir, "compositions", "texture.png"), "png");
  writeFileSync(
    join(dir, "compositions", "card.html"),
    `<!doctype html><html><head><style>
.card { background: url(../assets/logo.png); }
.card .bg { background: url(texture.png); }
</style></head><body>
<div data-composition-id="card" data-width="320" data-height="180" data-start="0" data-duration="2">
  <div class="bg"></div>
</div></body></html>`,
  );
  const mount = (start: number) =>
    `<div data-composition-id="card" data-composition-src="compositions/card.html" data-start="${start}"` +
    ` data-duration="2"></div>`;
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="6">
${[0, 2, 4].map(mount).join("\n")}
</div>
<script>window.__timelines = {};</script>
</body></html>`,
  );

  const bundled = await bundleToSingleHtml(dir, { inlineAssets: false });

  expect(bundled).toContain("url(compositions/texture.png)");
  expect(bundled).toContain("url(assets/logo.png)");
  const repeated = checked.filter((path, at) => checked.indexOf(path) !== at);
  expect(repeated).toEqual([]);
});
