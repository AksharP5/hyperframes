// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `studio:*` path predates telemetry/config.ts and shipped its own
// opt-out key and its own send loop, so it sat outside both contracts the
// canary work established: the documented opt-out did not silence it, and its
// events carried no cohort assignment. These pin both.

const DOCUMENTED_OPT_OUT = "hyperframes-studio:telemetryDisabled";
const LEGACY_OPT_OUT = "hf-studio-telemetry-opt-out";

vi.mock("../telemetry/canary", () => ({
  canaryEventProperties: () => ({ "$feature/canary-test-one": "true" }),
}));

describe("studioTelemetry — shared opt-out and canary properties", () => {
  let trackStudioEvent: typeof import("./studioTelemetry").trackStudioEvent;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
    ({ trackStudioEvent } = await import("./studioTelemetry"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Drain the queue and return the events the batch would have sent. */
  async function sentEvents(): Promise<Array<Record<string, unknown>>> {
    await vi.runOnlyPendingTimersAsync();
    if (fetchMock.mock.calls.length === 0) return [];
    const body = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const parsed = JSON.parse(body?.body ?? "{}") as { batch?: Array<Record<string, unknown>> };
    return parsed.batch ?? [];
  }

  it("honours the documented opt-out key", async () => {
    // Previously only the legacy key was checked, so a user who opted out the
    // documented way kept emitting every `studio:*` event.
    localStorage.setItem(DOCUMENTED_OPT_OUT, "1");
    trackStudioEvent("thing_happened");
    expect(await sentEvents()).toHaveLength(0);
  });

  it("still honours the legacy opt-out key", async () => {
    // Anyone already opted out this way must not be quietly re-enabled.
    localStorage.setItem(LEGACY_OPT_OUT, "1");
    trackStudioEvent("thing_happened");
    expect(await sentEvents()).toHaveLength(0);
  });

  it("attaches canary assignments to every event", async () => {
    trackStudioEvent("thing_happened");
    const events = await sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.["properties"]).toMatchObject({
      "$feature/canary-test-one": "true",
    });
  });

  it("lets an explicit property win over the canary mixin", async () => {
    trackStudioEvent("thing_happened", { "$feature/canary-test-one": "false" });
    const events = await sentEvents();
    expect(events[0]?.["properties"]).toMatchObject({
      "$feature/canary-test-one": "false",
    });
  });
});
