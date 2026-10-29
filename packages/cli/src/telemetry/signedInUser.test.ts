import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signedInHeygenUsername } from "./signedInUser.js";

describe("signedInHeygenUsername", () => {
  let dir: string;
  const saved = process.env["HEYGEN_CONFIG_DIR"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-signed-in-"));
    process.env["HEYGEN_CONFIG_DIR"] = dir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env["HEYGEN_CONFIG_DIR"];
    else process.env["HEYGEN_CONFIG_DIR"] = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (contents: unknown, mtime: number) => {
    const file = join(dir, "credentials");
    writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    utimesSync(file, mtime, mtime);
  };

  it("is undefined when nobody is signed in", () => {
    expect(signedInHeygenUsername()).toBeUndefined();
    write({ api_key: "hg_x" }, 1000);
    expect(signedInHeygenUsername()).toBeUndefined();
    write("hg_legacy_plain_key", 1001);
    expect(signedInHeygenUsername()).toBeUndefined();
  });

  it("returns the raw username after sign-in and drops it after sign-out", () => {
    write({ user: { username: "Alice" } }, 1999);
    expect(signedInHeygenUsername()).toBeUndefined();
    write({ api_key: "hg_x", user: { username: "Alice", email: "alice@example.com" } }, 2000);
    expect(signedInHeygenUsername()).toBe("Alice");
    write({ api_key: "hg_x" }, 2001);
    expect(signedInHeygenUsername()).toBeUndefined();
    rmSync(join(dir, "credentials"));
    expect(signedInHeygenUsername()).toBeUndefined();
  });
});
