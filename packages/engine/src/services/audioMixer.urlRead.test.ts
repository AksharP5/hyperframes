import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFfmpegBinary } from "../utils/ffmpegBinaries.js";
import { processCompositionAudio } from "./audioMixer.js";

const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;
const BYTES_PER_SECOND = 48_000 * 2 * 2;

// A range server like S3's (ffmpeg asks for `bytes=<start>-`). With `cut`, the first read starting
// at `cut.from` or later (past the probes' header reads) stops at `cut.at`, and every later request
// is refused, as for a link that just expired.
function serve(body: Buffer, cut?: { from: number; at: number }): Promise<Server> {
  let refusing = false;
  const server = createServer((req, res) => {
    if (refusing) return void res.writeHead(403).end("Request has expired");
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
    res.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": body.length - start,
      "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
      "Content-Type": "audio/wav",
    });
    const cutHere = cut !== undefined && start >= cut.from && start < cut.at;
    if (!cutHere) return void res.end(body.subarray(start));
    refusing = true;
    res.write(body.subarray(start, cut.at), () => res.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe.skipIf(!HAS_FFMPEG)("audio cut from a cloud-held file's URL", () => {
  let dir: string;
  let server: Server | undefined;

  function makeMedia(name: string, args: string[]): Buffer {
    const path = join(dir, name);
    const made = spawnSync(getFfmpegBinary(), ["-v", "error", "-y", ...args, path]);
    expect(made.status).toBe(0);
    return readFileSync(path);
  }

  const makeVoice = () =>
    makeMedia("voice.wav", [
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=20"],
      ...["-ac", "2", "-c:a", "pcm_s16le"],
    ]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-audio-url-read-"));
  });

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function mixFromUrl(
    clip: { name: string; type: "audio" | "video"; mediaStart: number; end: number } = {
      name: "voice.wav",
      type: "audio",
      mediaStart: 2,
      end: 10,
    },
  ) {
    const { port } = server!.address() as AddressInfo;
    const baseDir = join(dir, "project");
    return processCompositionAudio(
      [
        {
          id: "clip",
          src: `takes/${clip.name}`,
          start: 0,
          end: clip.end,
          mediaStart: clip.mediaStart,
          layer: 0,
          volume: 1,
          type: clip.type,
        },
      ],
      baseDir,
      join(dir, "work"),
      join(dir, "out.m4a"),
      clip.end,
      undefined,
      {
        urlByAbsentLocalPath: new Map([
          [join(baseDir, "takes", clip.name), `http://127.0.0.1:${port}/${clip.name}`],
        ]),
      },
    );
  }

  it("mixes the whole span when the URL serves it", async () => {
    server = await serve(makeVoice());

    const result = await mixFromUrl();

    expect(result.failures).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("fails the track when the read is cut mid-span, instead of padding it with silence", async () => {
    // The clip reads source seconds 2 to 12; the link fails at second 6.
    server = await serve(makeVoice(), { from: BYTES_PER_SECOND, at: 6 * BYTES_PER_SECOND });

    const result = await mixFromUrl();

    expect(result.success).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        elementId: "clip",
        stage: "prepare",
        reason: "download_failed",
        owner: "system",
        retryable: true,
      }),
    ]);
  });

  it("mixes a video whose audio track ends before its picture", async () => {
    const video = makeMedia("take.mp4", [
      ...["-f", "lavfi", "-i", "testsrc2=size=64x64:rate=25:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-movflags", "+faststart"],
    ]);
    server = await serve(video);

    const result = await mixFromUrl({ name: "take.mp4", type: "video", mediaStart: 0, end: 6 });

    expect(result.failures).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
