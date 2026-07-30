import { beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

// In-memory fake filesystem so these tests exercise the REAL config.ts
// module (parsing, caching, readConfigFresh's cache-bypass) without ever
// touching the developer/CI machine's actual ~/.hyperframes/config.json —
// homedir() is resolved once at config.ts's module-load time, so faking
// HOME via env var would only work in a fresh process, not inside a shared
// vitest worker.
const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => fsState.files.has(path)),
  mkdirSync: vi.fn(() => undefined),
  readFileSync: vi.fn((path: string) => {
    const content = fsState.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsState.files.set(path, content);
  }),
  // writeConfig writes atomically: temp file + rename over the target.
  renameSync: vi.fn((from: string, to: string) => {
    const content = fsState.files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    fsState.files.set(to, content);
    fsState.files.delete(from);
  }),
  // Legacy install-state cleanup after the migration to CONFIG_DIR.
  rmSync: vi.fn((path: string) => {
    fsState.files.delete(path);
  }),
}));

// Derived here rather than exported from config.ts: the pre-move path is
// frozen history, so pinning the literal is the point — an export would just
// let a rename pass silently, and it has no non-test consumer.
const LEGACY_STATE_PATH = join(homedir(), ".local", "state", "hyperframes", "install-state.json");

describe("config.ts — readConfig / readConfigFresh / writeConfig (real module, faked fs)", () => {
  let readConfig: typeof import("./config.js").readConfig;
  let readConfigFresh: typeof import("./config.js").readConfigFresh;
  let writeConfig: typeof import("./config.js").writeConfig;
  let writeConfigWithResult: typeof import("./config.js").writeConfigWithResult;
  let CONFIG_PATH: typeof import("./config.js").CONFIG_PATH;

  beforeEach(async () => {
    fsState.files.clear();
    // Fresh module instance per test — config.ts's `cachedConfig` is
    // module-scoped, so without this, a later test would silently inherit
    // an earlier test's cached read.
    vi.resetModules();
    ({ readConfig, readConfigFresh, writeConfig, writeConfigWithResult, CONFIG_PATH } =
      await import("./config.js"));
  });

  it("creates a default config with a fresh anonymousId when no file exists", () => {
    const config = readConfig();
    expect(config.telemetryEnabled).toBe(true);
    expect(config.anonymousId).toBeTruthy();
    expect(fsState.files.has(CONFIG_PATH)).toBe(true);
  });

  it("caches the read — a second readConfig() call does not see a file mutated out from under it", () => {
    const first = readConfig();
    fsState.files.set(CONFIG_PATH, JSON.stringify({ ...first, deParallelRouterTrialFired: true }));
    const second = readConfig();
    expect(second.deParallelRouterTrialFired).toBeUndefined();
  });

  it("readConfigFresh bypasses the cache and picks up a file written by another process", () => {
    const first = readConfig();
    fsState.files.set(CONFIG_PATH, JSON.stringify({ ...first, deParallelRouterTrialFired: true }));
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialFired).toBe(true);
  });

  it("writeConfig updates the in-process cache so a subsequent readConfig() sees the write immediately", () => {
    const config = readConfig();
    config.deParallelRouterTrialRenderCount = 5;
    writeConfig(config);
    const reread = readConfig();
    expect(reread.deParallelRouterTrialRenderCount).toBe(5);
  });

  it('treats a non-boolean deParallelRouterTrialFired (e.g. the JSON string "false") as unset, not truthy', () => {
    const base = readConfig();
    fsState.files.set(
      CONFIG_PATH,
      JSON.stringify({ ...base, deParallelRouterTrialFired: "false" }),
    );
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialFired).toBeUndefined();
  });

  it("treats a non-number deParallelRouterTrialRenderCount as unset", () => {
    const base = readConfig();
    fsState.files.set(
      CONFIG_PATH,
      JSON.stringify({ ...base, deParallelRouterTrialRenderCount: "5" }),
    );
    const fresh = readConfigFresh();
    expect(fresh.deParallelRouterTrialRenderCount).toBeUndefined();
  });

  it("fails closed when the file is corrupted instead of silently re-enabling telemetry", () => {
    fsState.files.set(CONFIG_PATH, "{not valid json");
    const config = readConfig();
    expect(config.telemetryEnabled).toBe(false);
    expect(config.anonymousId).toBeTruthy();
    expect(JSON.parse(fsState.files.get(CONFIG_PATH) ?? "{}")).toMatchObject({
      telemetryEnabled: false,
    });
  });

  it("writeConfig reports success, leaves no temp file behind, and reports failure when the fs throws", async () => {
    const config = readConfig();
    expect(writeConfig(config)).toBe(true);
    // Atomic write: the pid-suffixed temp file must have been renamed away.
    for (const path of fsState.files.keys()) {
      expect(path.endsWith(".tmp")).toBe(false);
    }

    const fs = await import("node:fs");
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(writeConfig(config)).toBe(false);

    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error("ENOSPC: disk full");
    });
    expect(writeConfigWithResult(config)).toEqual({
      ok: false,
      error: "ENOSPC: disk full",
    });
  });
});

describe("install-state rollover (breaker survives a config re-mint)", () => {
  let readConfig: typeof import("./config.js").readConfig;
  let readConfigFresh: typeof import("./config.js").readConfigFresh;
  let writeConfig: typeof import("./config.js").writeConfig;
  let CONFIG_PATH: typeof import("./config.js").CONFIG_PATH;
  let STATE_PATH: typeof import("./config.js").STATE_PATH;

  beforeEach(async () => {
    fsState.files.clear();
    vi.resetModules();
    ({ readConfig, readConfigFresh, writeConfig, CONFIG_PATH, STATE_PATH } =
      await import("./config.js"));
  });

  /** Simulate the identity reset this feature exists for. */
  function wipeConfig(): void {
    fsState.files.delete(CONFIG_PATH);
  }

  function stateFile(): Record<string, unknown> {
    const raw = fsState.files.get(STATE_PATH);
    expect(raw, "install-state file should exist").toBeDefined();
    return JSON.parse(raw as string) as Record<string, unknown>;
  }

  it("a truly fresh install writes the marker and records predecessorFound: false", () => {
    const config = readConfig();
    expect(config.predecessorFound).toBe(false);
    expect(stateFile()["markerAt"]).toEqual(expect.any(String));
  });

  it("a re-mint after a config wipe finds the marker: predecessorFound is true, id is fresh", () => {
    const first = readConfig();
    wipeConfig();
    const second = readConfigFresh();
    expect(second.predecessorFound).toBe(true);
    // The rollover carries safety state, never identity.
    expect(second.anonymousId).not.toBe(first.anonymousId);
  });

  it("a tripped breaker survives a config wipe — the whole point", () => {
    const config = readConfig();
    config.deParallelRouterTrialFired = true;
    writeConfig(config);
    wipeConfig();
    const reborn = readConfigFresh();
    expect(reborn.deParallelRouterTrialFired).toBe(true);
  });

  it("an untripped breaker does NOT get invented by the rollover", () => {
    readConfig();
    wipeConfig();
    expect(readConfigFresh().deParallelRouterTrialFired).toBeUndefined();
  });

  it("a tripped breaker survives config CORRUPTION via the same path", () => {
    const config = readConfig();
    config.deParallelRouterTrialFired = true;
    writeConfig(config);
    fsState.files.set(CONFIG_PATH, "{not valid json");
    expect(readConfigFresh().deParallelRouterTrialFired).toBe(true);
  });

  it("the state file holds no telemetry identity — marker, breaker fact, bucket seed only", () => {
    const config = readConfig();
    config.deParallelRouterTrialFired = true;
    writeConfig(config);
    expect(Object.keys(stateFile()).sort()).toEqual([
      "bucketSeed",
      "deParallelRouterTrialFired",
      "markerAt",
    ]);
    // The seed is a separate random UUID, never the anonymousId — the old
    // telemetry id must not survive a wipe in any form.
    expect(config.bucketSeed).not.toBe(config.anonymousId);
    expect(JSON.stringify(stateFile())).not.toContain(config.anonymousId);
  });

  it("marker timestamp is written once, not refreshed by later config writes", () => {
    const config = readConfig();
    const minted = stateFile()["markerAt"];
    config.commandCount = 42;
    config.deParallelRouterTrialFired = true;
    writeConfig(config);
    expect(stateFile()["markerAt"]).toBe(minted);
  });

  it("a corrupted state file reads as absent rather than breaking the mint", () => {
    fsState.files.set(STATE_PATH, "{not valid json");
    const config = readConfig();
    expect(config.predecessorFound).toBe(false);
    expect(config.anonymousId).toBeTruthy();
    // And the corrupt file was replaced with a valid marker by the mint's write.
    expect(stateFile()["markerAt"]).toEqual(expect.any(String));
  });

  it("a state-file write failure never breaks the config write", async () => {
    const fs = await import("node:fs");
    const config = readConfig(); // marker already written by the mint
    fsState.files.delete(STATE_PATH); // force a re-sync attempt...
    const { __resetInstallStateSyncForTests } = await import("./config.js");
    __resetInstallStateSyncForTests();
    let calls = 0;
    vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
      calls++;
      if (String(path).startsWith(STATE_PATH)) throw new Error("EACCES");
      fsState.files.set(String(path), String(content));
    });
    config.commandCount = 1;
    expect(writeConfig(config)).toBe(true); // ...that fails, swallowed
    expect(calls).toBeGreaterThan(1);
    vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
      fsState.files.set(String(path), String(content));
    });
  });

  it("predecessorFound on an EXISTING config predating the field reads as undefined, not false", () => {
    const base = readConfig();
    const { predecessorFound: _dropped, ...legacy } = base;
    fsState.files.set(CONFIG_PATH, JSON.stringify(legacy));
    expect(readConfigFresh().predecessorFound).toBeUndefined();
  });

  // The move: state used to live in ~/.local/state/hyperframes/ so it would
  // survive `rm -rf ~/.hyperframes`. Review rejected persisting state outside
  // the config dir to defeat the user's reset, so it now shares CONFIG_DIR.
  it("keeps install-state inside the config dir, so deleting that dir is a full reset", () => {
    readConfig();
    expect(STATE_PATH.startsWith(CONFIG_PATH.replace(/config\.json$/, ""))).toBe(true);
    expect(STATE_PATH).not.toContain(".local");
  });

  it("adopts a pre-move state file so an upgrading install keeps its tripped breaker", () => {
    fsState.files.set(
      LEGACY_STATE_PATH,
      JSON.stringify({ markerAt: "2026-07-28T00:00:00.000Z", deParallelRouterTrialFired: true }),
    );
    // Config absent => mintConfig consults install state; without the
    // migration this install silently re-enrols in the failed trial.
    const config = readConfig();
    expect(config.deParallelRouterTrialFired).toBe(true);
    expect(config.predecessorFound).toBe(true);
    expect(fsState.files.has(STATE_PATH), "state migrated into CONFIG_DIR").toBe(true);
    expect(fsState.files.has(LEGACY_STATE_PATH), "legacy copy removed").toBe(false);
  });

  it("lets the current location win over a stale legacy file, and deletes the legacy copy", () => {
    // A user who cleared the breaker must not have it resurrected by a
    // leftover file from the old scheme.
    fsState.files.set(
      LEGACY_STATE_PATH,
      JSON.stringify({ markerAt: "2026-07-28T00:00:00.000Z", deParallelRouterTrialFired: true }),
    );
    fsState.files.set(STATE_PATH, JSON.stringify({ markerAt: "2026-07-30T00:00:00.000Z" }));
    expect(readConfig().deParallelRouterTrialFired).toBeUndefined();
    expect(fsState.files.has(LEGACY_STATE_PATH)).toBe(false);
  });
});

describe("bucket-seed carryover (cohorts survive a config wipe)", () => {
  let readConfig: typeof import("./config.js").readConfig;
  let readConfigFresh: typeof import("./config.js").readConfigFresh;
  let writeConfig: typeof import("./config.js").writeConfig;
  let CONFIG_PATH: typeof import("./config.js").CONFIG_PATH;
  let STATE_PATH: typeof import("./config.js").STATE_PATH;

  beforeEach(async () => {
    fsState.files.clear();
    vi.resetModules();
    ({ readConfig, readConfigFresh, writeConfig, CONFIG_PATH, STATE_PATH } =
      await import("./config.js"));
  });

  it("a fresh install mints a seed distinct from its anonymousId and mirrors it to the state file", () => {
    const config = readConfig();
    expect(config.bucketSeed).toBeTruthy();
    expect(config.bucketSeed).not.toBe(config.anonymousId);
    const state = JSON.parse(fsState.files.get(STATE_PATH) as string) as { bucketSeed?: string };
    expect(state.bucketSeed).toBe(config.bucketSeed);
  });

  it("the seed survives a config.json re-mint — cohorts hold, only the id re-rolls", () => {
    const first = readConfig();
    fsState.files.delete(CONFIG_PATH);
    const second = readConfigFresh();
    expect(second.bucketSeed).toBe(first.bucketSeed);
    expect(second.anonymousId).not.toBe(first.anonymousId);
  });

  // The counterpart, and the reason install-state shares CONFIG_DIR: a seed
  // that outlived `rm -rf ~/.hyperframes` would be a persistent identifier
  // defeating the only reset the user has.
  it("the seed does NOT survive deleting the config dir — that reset is real", () => {
    const first = readConfig();
    fsState.files.delete(CONFIG_PATH);
    fsState.files.delete(STATE_PATH);
    const reborn = readConfigFresh();
    expect(reborn.bucketSeed).toBeTruthy();
    expect(reborn.bucketSeed).not.toBe(first.bucketSeed);
    expect(reborn.predecessorFound).toBe(false);
  });

  it("adopts a pre-move seed so the migration does not reshuffle a live cohort", () => {
    fsState.files.set(
      LEGACY_STATE_PATH,
      JSON.stringify({ markerAt: "2026-07-28T00:00:00.000Z", bucketSeed: "seed-from-old-path" }),
    );
    expect(readConfig().bucketSeed).toBe("seed-from-old-path");
    expect(fsState.files.has(LEGACY_STATE_PATH), "legacy copy removed").toBe(false);
  });

  it("the seed survives config corruption via the same mint path", () => {
    const first = readConfig();
    fsState.files.set(CONFIG_PATH, "{not valid json");
    expect(readConfigFresh().bucketSeed).toBe(first.bucketSeed);
  });

  it("the state-file seed is write-once — a later install never overwrites the lineage seed", () => {
    const first = readConfig();
    fsState.files.delete(CONFIG_PATH);
    const second = readConfigFresh();
    // Force more config writes from the second install; the state seed must not move.
    second.commandCount = 7;
    writeConfig(second);
    const state = JSON.parse(fsState.files.get(STATE_PATH) as string) as { bucketSeed?: string };
    expect(state.bucketSeed).toBe(first.bucketSeed);
  });

  it("a legacy config without a seed is backfilled ONCE and stays stable across fresh reads", () => {
    const base = readConfig();
    const { bucketSeed: _dropped, ...legacy } = base;
    fsState.files.set(CONFIG_PATH, JSON.stringify(legacy));
    fsState.files.delete(STATE_PATH); // no lineage either — pure legacy machine
    const first = readConfigFresh();
    expect(first.bucketSeed).toBeTruthy();
    const second = readConfigFresh();
    expect(second.bucketSeed).toBe(first.bucketSeed); // persisted, not re-rolled per read
  });

  it("a legacy config adopts the lineage seed from the state file when one exists", () => {
    const base = readConfig(); // wrote the state file with a seed
    const lineageSeed = base.bucketSeed;
    const { bucketSeed: _dropped, ...legacy } = base;
    fsState.files.set(CONFIG_PATH, JSON.stringify(legacy));
    expect(readConfigFresh().bucketSeed).toBe(lineageSeed);
  });
});
