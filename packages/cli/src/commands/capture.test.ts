import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliRuntimeError } from "../utils/commandResult.js";

const { captureWebsiteMock } = vi.hoisted(() => ({
  captureWebsiteMock: vi.fn(async (options: unknown) => {
    if (typeof options === "object" && options !== null) {
      const onPhase = Reflect.get(options, "onPhase");
      if (typeof onPhase === "function") {
        onPhase({
          schema: "hyperframes.capture.phase.v1",
          phase: "vision",
          status: "degraded",
          remainingMs: 0,
          reason: "budget-exhausted",
        });
      }
    }
    return {
      ok: true,
      projectDir: "/tmp/capture",
      url: "https://example.com",
      title: "Example",
      extracted: {},
      screenshots: [],
      tokens: { sections: [], fonts: [] },
      assets: [],
      warnings: [],
    };
  }),
}));

vi.mock("../capture/index.js", () => ({ captureWebsite: captureWebsiteMock }));

import captureCommand from "./capture.js";

describe("capture command — vision control", () => {
  afterEach(() => {
    captureWebsiteMock.mockClear();
    vi.restoreAllMocks();
  });

  it("declares --skip-vision as an opt-in boolean", () => {
    const skipVisionArg = captureCommand.args
      ? Reflect.get(captureCommand.args, "skip-vision")
      : undefined;
    expect(skipVisionArg).toMatchObject({
      type: "boolean",
      default: false,
    });
  });

  it("plumbs --skip-vision into capture options", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await captureCommand.run!({
      args: {
        url: "https://example.com",
        output: "/tmp/hf-skip-vision-test",
        "skip-assets": false,
        "skip-vision": true,
        json: true,
      },
    } as never);

    expect(captureWebsiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ skipVision: true }),
      undefined,
    );
  });

  it("emits a versioned phase record without the captured URL", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await captureCommand.run!({
      args: {
        url: "https://user:secret@example.com/private",
        output: "/tmp/hf-phase-progress-test",
        "skip-assets": false,
        "skip-vision": false,
        json: true,
      },
    } as never);

    const line = error.mock.calls.find(
      ([value]) => typeof value === "string" && value.startsWith("HYPERFRAMES_CAPTURE_PHASE "),
    )?.[0];
    expect(typeof line).toBe("string");
    if (typeof line !== "string") throw new Error("Expected capture phase diagnostic");
    const event = JSON.parse(line.slice("HYPERFRAMES_CAPTURE_PHASE ".length));
    expect(event).toEqual({
      schema: "hyperframes.capture.phase.v1",
      phase: "vision",
      status: "degraded",
      remainingMs: 0,
      reason: "budget-exhausted",
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("/private");
  });

  it("keeps required capture failures nonzero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-capture-failure-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureWebsiteMock.mockRejectedValueOnce(new Error("required extraction failed"));

    try {
      await expect(
        captureCommand.run!({
          args: {
            url: "https://example.com",
            output: dir,
            "skip-assets": false,
            "skip-vision": false,
            json: true,
          },
        } as never),
      ).rejects.toBeInstanceOf(CliRuntimeError);
      const payload = log.mock.calls.at(-1)?.[0];
      expect(typeof payload).toBe("string");
      if (typeof payload !== "string") throw new Error("Expected JSON failure payload");
      expect(JSON.parse(payload)).toMatchObject({ ok: false, error: "required extraction failed" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
