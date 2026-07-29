import { describe, expect, it } from "vitest";
import { classifyFfmpegSpawnError } from "./videoFrameExtractor.js";

describe("classifyFfmpegSpawnError", () => {
  it.each(["ENOENT", "EACCES", "ENOEXEC", "UNKNOWN"])(
    "keeps deterministic launch failure %s terminal",
    (code) => {
      expect(classifyFfmpegSpawnError(Object.assign(new Error(code), { code }))).toMatchObject({
        retryable: false,
      });
    },
  );

  it.each(["EAGAIN", "EMFILE", "ENFILE"])("retries known transient launch failure %s", (code) => {
    expect(classifyFfmpegSpawnError(Object.assign(new Error(code), { code }))).toMatchObject({
      kind: "ffmpeg_transient",
      retryable: true,
    });
  });
});
