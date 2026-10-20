import { afterEach, describe, expect, it, vi } from "vitest";
import { runFfmpeg, type RunFfmpegResult } from "@hyperframes/engine";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  runFfmpeg: vi.fn(),
}));

const FRAME =
  "[Parsed_ebur128_0 @ 0x1] t: 0.1 M:-20.0 S:-20.0 I:-20.0 LUFS FTPK: -3.0 dBFS TPK: -3.0 dBFS";
const SUMMARY = "  True peak:\n    Peak:        -3.0 dBFS";
const ran = (success: boolean, stderr: string): RunFfmpegResult => ({
  success,
  exitCode: success ? 0 : 1,
  stderr,
  durationMs: 1,
  terminationReason: "exit",
});
const segments = { durationSeconds: 180, sampleRate: 48_000 };

afterEach(() => vi.mocked(runFfmpeg).mockReset());

describe("measureTruePeakDbfs against ffmpeg's stderr", () => {
  it("throws when ffmpeg prints no true-peak summary", async () => {
    vi.mocked(runFfmpeg).mockImplementation(async (_, opts) => {
      opts?.onStderr?.(`${FRAME}\n`);
      return ran(true, FRAME);
    });
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).rejects.toThrow(
      "FFmpeg did not report AAC true peak",
    );
  });

  it("measures a rate other than 48 kHz in one whole-file pass", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    const peak = await measureTruePeakDbfs("in.m4a", {
      timeoutMs: 1000,
      segments: { ...segments, sampleRate: 44_100 },
    });
    expect(peak).toBe(-3);
    expect(runFfmpeg).toHaveBeenCalledOnce();
  });

  it("stops the other segment scans when one fails", async () => {
    const others: (AbortSignal | undefined)[] = [];
    vi.mocked(runFfmpeg).mockImplementation(async (args, opts) => {
      if (args.some((arg) => arg.startsWith("atrim=start_sample=0:"))) return ran(false, "boom");
      others.push(opts?.signal);
      const signal = opts?.signal;
      if (signal) await new Promise((stop) => signal.addEventListener("abort", stop));
      return ran(false, "stopped");
    });
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000, segments })).rejects.toThrow();
    expect(others.map((signal) => signal?.aborted)).toEqual([true, true]);
  });
});
