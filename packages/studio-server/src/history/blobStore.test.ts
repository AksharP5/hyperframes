// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { openBlobStore } from "./blobStore.js";

const { renameSync: realRenameSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
const { rename: realRename } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const busy = () => Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
const platform = process.platform;

// Undo and redo on Windows: a file the preview or an editor holds open refuses a rename over it for a moment.
describe("the history store on Windows, while another process briefly holds a file", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hf-blob-busy-"));
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    vi.mocked(fs.renameSync).mockImplementation(realRenameSync);
    vi.mocked(fsp.rename).mockImplementation(realRename);
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a file back into the project once the hold clears", async () => {
    const source = join(root, "source.html");
    writeFileSync(source, "<p>before</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    const hash = await store.put(source);
    const target = join(root, "index.html");
    writeFileSync(target, "<p>after</p>");
    let refused = 0;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (refused++ < 2) throw busy();
      return realRenameSync(from, to);
    });

    await store.writeTo(hash, target);

    expect(readFileSync(target, "utf8")).toBe("<p>before</p>");
    expect(refused).toBe(3);
  });

  it("files a copy in the store once the hold clears", async () => {
    const source = join(root, "clip.html");
    writeFileSync(source, "<p>kept</p>");
    const store = await openBlobStore(join(root, "history", "blobs"));
    let refused = 0;
    vi.mocked(fsp.rename).mockImplementation(async (from, to) => {
      if (refused++ < 2) throw busy();
      return realRename(from, to);
    });

    const hash = await store.put(source);

    expect((await store.read(hash)).toString("utf8")).toBe("<p>kept</p>");
    expect(refused).toBe(3);
  });
});
