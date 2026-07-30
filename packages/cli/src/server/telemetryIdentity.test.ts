import { describe, expect, it, vi, beforeEach } from "vitest";

// CLI → Studio telemetry identity seeding (Layer 1). Verifies the server only
// hands the browser a distinct id when CLI telemetry is enabled, and passes
// through the anonymous machine id (no PII) otherwise.

const shouldTrack = vi.fn();
const readConfig = vi.fn();
// Pinned rather than using the real registry, so these string assertions
// don't move every time a canary is added, ramped, or retired.
const canaryDecisions = vi.fn<() => Record<string, boolean>>();

vi.mock("../telemetry/client.js", () => ({
  shouldTrack: (...args: unknown[]) => shouldTrack(...args),
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: (...args: unknown[]) => readConfig(...args),
}));
vi.mock("../telemetry/canary.js", () => ({
  canaryDecisionsForStudio: () => canaryDecisions(),
}));

const { resolveCliTelemetryDistinctId, buildCliIdentityScript, buildStudioHeadScripts } =
  await import("./telemetryIdentity.js");

describe("resolveCliTelemetryDistinctId", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  it("returns the CLI anonymousId when telemetry is enabled", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBe("machine-uuid");
  });

  it("returns null when telemetry is disabled (opt-out / dev / CI)", () => {
    shouldTrack.mockReturnValue(false);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
    // Must not even read config when suppressed.
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("returns null when there is no anonymousId", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });

  it("never throws — returns null if config reading fails", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockImplementation(() => {
      throw new Error("disk error");
    });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });
});

describe("buildCliIdentityScript", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  it("emits a script that sets window.__HF_CLI_DISTINCT_ID when telemetry is on", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";</script>',
    );
  });

  it("also seeds window.__HF_CLI_BUCKET_SEED when the config carries a bucket seed", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid", bucketSeed: "seed-uuid" });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";window.__HF_CLI_BUCKET_SEED="seed-uuid";</script>',
    );
  });

  it("emits an empty string when telemetry is off and there are no canaries", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildCliIdentityScript()).toBe("");
  });

  // The cross-surface fix: with telemetry off the CLI resolves every canary
  // to telemetry_opt_out, and Studio cannot see that from its own separate
  // localStorage flag. Publishing the DECISIONS (not the identity) is what
  // stops Studio evaluating independently and enrolling anyway.
  it("still publishes canary decisions when telemetry is off, but no identity", () => {
    shouldTrack.mockReturnValue(false);
    canaryDecisions.mockReturnValue({ "de-parallel-router": false });
    const script = buildCliIdentityScript();
    expect(script).toBe(
      '<script>window.__HF_CLI_CANARY_DECISIONS={"de-parallel-router":false};</script>',
    );
    expect(script).not.toContain("__HF_CLI_DISTINCT_ID");
    expect(script).not.toContain("__HF_CLI_BUCKET_SEED");
  });

  it("publishes decisions alongside the identity when telemetry is on", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid", bucketSeed: "seed-uuid" });
    canaryDecisions.mockReturnValue({ "de-parallel-router": true });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";' +
        'window.__HF_CLI_BUCKET_SEED="seed-uuid";' +
        'window.__HF_CLI_CANARY_DECISIONS={"de-parallel-router":true};</script>',
    );
  });

  it("escapes a canary name that tries to close the script tag", () => {
    shouldTrack.mockReturnValue(false);
    canaryDecisions.mockReturnValue({ "</script><script>alert(1)": true });
    const script = buildCliIdentityScript();
    expect(script).not.toContain("</script><script>alert(1)");
    expect(script).toContain("__HF_CLI_CANARY_DECISIONS");
  });

  it("survives a throwing canary resolver — telemetry must never break preview", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    canaryDecisions.mockImplementation(() => {
      throw new Error("registry blew up");
    });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";</script>',
    );
  });

  it("JSON-encodes the id so it can't break out of the script literal", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "</script><script>alert(1)" });
    const script = buildCliIdentityScript();
    // The raw closing tag must be escaped by JSON.stringify, not emitted literally.
    expect(script).not.toContain("</script><script>alert(1)");
    expect(script).toContain("window.__HF_CLI_DISTINCT_ID=");
  });
});

describe("buildStudioHeadScripts", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  const ENV_SCRIPT = "<script>window.__HF_STUDIO_ENV__={};</script>";

  it("places the CLI identity script before the env script so the global is set first", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    const head = buildStudioHeadScripts(ENV_SCRIPT);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeGreaterThanOrEqual(0);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeLessThan(head.indexOf("__HF_STUDIO_ENV__"));
  });

  it("returns just the env script when there is no identity and no canary", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildStudioHeadScripts(ENV_SCRIPT)).toBe(ENV_SCRIPT);
  });
});
