import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  vi.doUnmock("./commands/init.js");
  vi.doUnmock("./telemetry/events.js");
  vi.doUnmock("./telemetry/index.js");
  vi.resetModules();
});

describe("CLI lifecycle", () => {
  it("queues a command failure before finalizing telemetry", async () => {
    let resolveEvents!: (events: {
      trackCommandFailure: (command: string, error: unknown) => void;
    }) => void;
    const eventsModule = new Promise<{
      trackCommandFailure: (command: string, error: unknown) => void;
    }>((resolve) => {
      resolveEvents = resolve;
    });
    let markEventsImportStarted!: () => void;
    const eventsImportStarted = new Promise<void>((resolve) => {
      markEventsImportStarted = resolve;
    });
    const order: string[] = [];

    vi.doMock("./commands/init.js", () => ({
      default: {
        meta: { name: "init" },
        args: { json: { type: "boolean" } },
        run: vi.fn(),
      },
    }));
    vi.doMock("./telemetry/index.js", () => ({
      flush: async () => {
        order.push("flush");
      },
      flushSync: vi.fn(),
      incrementCommandCount: vi.fn(),
      showTelemetryNotice: vi.fn(),
      shouldTrack: () => false,
      trackCliError: vi.fn(),
      trackCommand: vi.fn(),
      trackCommandResult: vi.fn(),
    }));
    vi.doMock("./telemetry/events.js", async () => {
      markEventsImportStarted();
      return eventsModule;
    });

    process.argv = ["node", "cli.ts", "init", "--bogus", "--json"];
    const execution = import("./cli.js");

    await eventsImportStarted;
    expect(order).toEqual([]);

    resolveEvents({
      trackCommandFailure: () => {
        order.push("cli_error");
      },
    });
    await execution;

    expect(order).toEqual(["cli_error", "flush"]);
  });
});
