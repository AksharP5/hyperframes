import { describe, expect, it, vi, beforeEach } from "vitest";

const configState: { anonymousId: string; bucketSeed: string | undefined } = {
  anonymousId: "db0c1f4a-b95e-4c35-90c6-1a15bd76f717",
  bucketSeed: undefined,
};
const systemState = { is_ci: false };

vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: configState.anonymousId, bucketSeed: configState.bucketSeed }),
}));
vi.mock("./system.js", () => ({
  getSystemMeta: () => ({ is_ci: systemState.is_ci }),
}));

// The registry is data; pin a known shape so these tests don't move when a
// real canary is added or ramped.
vi.mock("@hyperframes/core/canary-registry", async () => {
  const actual = await vi.importActual<typeof import("@hyperframes/core/canary-registry")>(
    "@hyperframes/core/canary-registry",
  );
  return {
    ...actual,
    CANARIES: [
      {
        name: "test-alpha",
        percentage: 100,
        description: "always on",
        owner: "t",
        sunsetAfter: "2099-01-01",
      },
      {
        name: "test-beta",
        percentage: 0,
        description: "always off",
        owner: "t",
        sunsetAfter: "2099-01-01",
      },
    ],
    findCanary: (n: string) =>
      [
        {
          name: "test-alpha",
          percentage: 100,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
        {
          name: "test-beta",
          percentage: 0,
          description: "",
          owner: "t",
          sunsetAfter: "2099-01-01",
        },
      ].find((c) => c.name === n),
  };
});

const { isCanaryEnabled, resolveCanary, canaryEventProperties, __resetCanaryCacheForTests } =
  await import("./canary.js");

beforeEach(() => {
  __resetCanaryCacheForTests();
  configState.anonymousId = "db0c1f4a-b95e-4c35-90c6-1a15bd76f717";
  configState.bucketSeed = undefined;
  systemState.is_ci = false;
  delete process.env.HF_CANARY_TEST_ALPHA;
  delete process.env.HF_CANARY_TEST_BETA;
});

describe("bucketing unit", () => {
  it("buckets on the bucketSeed when present — the unit that survives config wipes", async () => {
    const { evaluateCanary } = await import("@hyperframes/core/canary");
    configState.bucketSeed = "5f1c9d2e-0000-4000-8000-aaaaaaaaaaaa";
    const viaBinding = resolveCanary("test-alpha").bucket;
    const bySeed = evaluateCanary({
      feature: "test-alpha",
      unitId: configState.bucketSeed,
      percentage: 100,
    }).bucket;
    const byId = evaluateCanary({
      feature: "test-alpha",
      unitId: configState.anonymousId,
      percentage: 100,
    }).bucket;
    expect(viaBinding).toBe(bySeed);
    // Only meaningful if the two units actually bucket differently.
    expect(bySeed).not.toBe(byId);
  });

  it("falls back to the anonymousId when no seed exists (failed legacy backfill)", async () => {
    const { evaluateCanary } = await import("@hyperframes/core/canary");
    const viaBinding = resolveCanary("test-alpha").bucket;
    const byId = evaluateCanary({
      feature: "test-alpha",
      unitId: configState.anonymousId,
      percentage: 100,
    }).bucket;
    expect(viaBinding).toBe(byId);
  });
});

describe("CLI canary binding", () => {
  it("reads the percentage from the registry", () => {
    expect(isCanaryEnabled("test-alpha")).toBe(true);
    expect(isCanaryEnabled("test-beta")).toBe(false);
  });

  it("an unregistered name is off, not a throw — a typo must not break a render", () => {
    expect(isCanaryEnabled("does-not-exist")).toBe(false);
    expect(resolveCanary("does-not-exist").reason).toBe("out_of_cohort");
  });

  it("HF_CANARY_<FEATURE> overrides the registry in both directions", () => {
    process.env.HF_CANARY_TEST_ALPHA = "off";
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "forced_off" });
    expect(resolveCanary("test-beta")).toMatchObject({ enabled: true, reason: "forced_on" });
  });

  it("excludes CI from percentage enrolment, but an override still reaches it", () => {
    systemState.is_ci = true;
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "excluded" });

    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_ALPHA = "on";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: true, reason: "forced_on" });
  });

  it("fails closed when the install has no anonymousId", () => {
    configState.anonymousId = "";
    expect(resolveCanary("test-alpha")).toMatchObject({ enabled: false, reason: "no_unit_id" });
  });

  it("memoizes so a decision cannot change mid-process", () => {
    expect(isCanaryEnabled("test-beta")).toBe(false);
    // A late env change must NOT flip a render that already started.
    process.env.HF_CANARY_TEST_BETA = "on";
    expect(isCanaryEnabled("test-beta")).toBe(false);
    __resetCanaryCacheForTests();
    expect(isCanaryEnabled("test-beta")).toBe(true);
  });

  it("emits PostHog flag-shaped properties for every registered canary", () => {
    expect(canaryEventProperties()).toEqual({
      "$feature/canary-test-alpha": "true",
      "$feature/canary-test-beta": "false",
    });

    __resetCanaryCacheForTests();
    process.env.HF_CANARY_TEST_ALPHA = "off";
    expect(canaryEventProperties()["$feature/canary-test-alpha"]).toBe("false");
  });
});
