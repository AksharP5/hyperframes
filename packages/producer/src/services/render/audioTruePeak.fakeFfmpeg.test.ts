import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractAudioMetadata, runFfmpeg, type RunFfmpegResult } from "@hyperframes/engine";
import { padOrTrimAudioToVideoFrameCount } from "./audioPadTrim.js";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  extractAudioMetadata: vi.fn(),
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
const probed = (durationSeconds: number, sampleRate: number) =>
  vi.mocked(extractAudioMetadata).mockResolvedValue({
    durationSeconds,
    sampleRate,
    channels: 2,
    audioCodec: "aac",
  });
const scanFilters = () =>
  vi
    .mocked(runFfmpeg)
    .mock.calls.map(([args]) => args.find((arg) => arg.includes("ebur128")))
    .filter(Boolean);

beforeEach(() => probed(180, 48_000));
afterEach(() => vi.mocked(runFfmpeg).mockReset());

describe("measureTruePeakDbfs against ffmpeg's stderr", () => {
  it("throws when ffmpeg prints no true-peak summary", async () => {
    vi.mocked(runFfmpeg).mockImplementation(async (_, opts) => {
      opts?.onStderr?.(`${FRAME}\n`);
      return ran(true, FRAME);
    });
    probed(30, 48_000);
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).rejects.toThrow(
      "FFmpeg did not report AAC true peak",
    );
  });

  it("measures a rate other than 48 kHz in one whole-file pass", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    probed(180, 44_100);
    const peak = await measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 });
    expect(peak).toBe(-3);
    expect(scanFilters()).toEqual(["ebur128=peak=true"]);
  });

  it("measures a file of unknown length in one whole-file pass", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    probed(Number.NaN, 48_000);
    expect(await measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).toBe(-3);
    expect(scanFilters()).toEqual(["ebur128=peak=true"]);
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
    await expect(measureTruePeakDbfs("in.m4a", { timeoutMs: 1000 })).rejects.toThrow();
    expect(others.map((signal) => signal?.aborted)).toEqual([true, true]);
  });
});

describe("a local render's audio pad/trim", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-pad-trim-peak-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("checks the true peak in the same parallel segments as the distributed plan", async () => {
    vi.mocked(runFfmpeg).mockResolvedValue(ran(true, `${FRAME}\n${SUMMARY}`));
    const result = await padOrTrimAudioToVideoFrameCount({
      videoPath: join(dir, "video.mp4"),
      audioPath: join(dir, "audio.m4a"),
      outputPath: join(dir, "audio.duration-normalized.m4a"),
      probeVideoFrameInfo: async () => ({ frameCount: 5400, fpsNum: 30, fpsDen: 1 }),
      probeAudioInfo: async () => ({ durationSeconds: 180 }),
    });
    expect(result.success).toBe(true);
    expect(scanFilters()).toEqual([
      "atrim=start_sample=0:end_sample=2880000,ebur128=peak=true",
      "atrim=start_sample=2875200:end_sample=5760000,ebur128=peak=true",
      "atrim=start_sample=5755200,ebur128=peak=true",
    ]);
  });
});
