import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectRelativeSrc } from "@hyperframes/engine";
import { appendAutoDetectedVideoAudio, shouldCopyExtractedFrames } from "./extractVideosStage.js";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";

function makeVideo(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v1",
    src: "clip.mp4",
    start: 0,
    end: 5,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
    ...overrides,
  };
}

function makeExtracted(videoId: string, fileHasAudio: boolean): ExtractedFrames {
  return {
    videoId,
    srcPath: "/tmp/clip.mp4",
    outputDir: "/tmp/frames",
    framePattern: "frame_%05d.jpg",
    fps: 30,
    totalFrames: 150,
    framePaths: new Map(),
    metadata: {
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: fileHasAudio,
    },
  } as ExtractedFrames;
}

describe("appendAutoDetectedVideoAudio", () => {
  it("adds audio for an audible video whose file has an audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
    expect(composition.audios[0]).toMatchObject({
      id: "v1-audio",
      src: "clip.mp4",
    });
  });

  it("skips a muted video even when the source file has audio", () => {
    const composition = {
      videos: [makeVideo({ hasAudio: false })],
      audios: [] as never[],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("skips when the source file has no audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", false)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("does not duplicate audio for a src already in the mix", () => {
    const composition = {
      videos: [makeVideo()],
      audios: [
        {
          id: "existing",
          src: "clip.mp4",
          start: 0,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "video" as const,
        },
      ],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
  });
});

// The HDR probes in this stage resolve `<video>`/`<img>` srcs with
// resolveProjectRelativeSrc and NO isAbsolute() pre-check. These pin the src
// shapes that a pre-check would silently break — an earlier revision of the
// PRINFRA-349 fix short-circuited on isAbsolute and left root-relative srcs
// percent-encoded, so the HDR image never resolved and the render shipped SDR.
describe("HDR probe src resolution (PRINFRA-349)", () => {
  it("decodes a percent-encoded CJK src to the real on-disk path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-cjk-"));
    const compiledDir = mkdtempSync(join(tmpdir(), "hf-probe-compiled-"));
    try {
      const realName = "图1.png";
      writeFileSync(join(projectDir, realName), "x");
      // The compiled DOM carries the URL-encoded attribute value.
      const encoded = encodeURIComponent(realName); // %E5%9B%BE1.png
      expect(resolveProjectRelativeSrc(encoded, projectDir, compiledDir)).toBe(
        join(projectDir, realName),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(compiledDir, { recursive: true, force: true });
    }
  });

  it("decodes a percent-encoded CJK src served from a browser origin-root URL", () => {
    // Regression guard: `isAbsolute("/assets/%E5%9B%BE1.png")` is true on POSIX,
    // so a pre-check would return it verbatim, existsSync would fail, and the
    // image would never enter nativeHdrImageIds — a silent SDR render.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-root-"));
    try {
      mkdirSync(join(projectDir, "assets"));
      const realName = "图1.png";
      writeFileSync(join(projectDir, "assets", realName), "x");
      const rootRelative = `/assets/${encodeURIComponent(realName)}`;
      expect(resolveProjectRelativeSrc(rootRelative, projectDir, projectDir)).toBe(
        join(projectDir, "assets", realName),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prefers compiledDir over projectDir when both hold the asset", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-proj-"));
    const compiledDir = mkdtempSync(join(tmpdir(), "hf-probe-comp-"));
    try {
      writeFileSync(join(projectDir, "clip.mp4"), "x");
      writeFileSync(join(compiledDir, "clip.mp4"), "x");
      expect(resolveProjectRelativeSrc("clip.mp4", projectDir, compiledDir)).toBe(
        join(compiledDir, "clip.mp4"),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(compiledDir, { recursive: true, force: true });
    }
  });

  it("returns an existing absolute path unchanged", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-probe-abs-"));
    try {
      const abs = join(projectDir, "clip.mp4");
      writeFileSync(abs, "x");
      expect(resolveProjectRelativeSrc(abs, projectDir, projectDir)).toBe(abs);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("shouldCopyExtractedFrames", () => {
  it("copies frames on Windows (symlinkSync throws EPERM without Developer Mode)", () => {
    expect(shouldCopyExtractedFrames("win32")).toBe(true);
  });

  it("symlinks on macOS and Linux (cheaper, symlinks allowed)", () => {
    expect(shouldCopyExtractedFrames("darwin")).toBe(false);
    expect(shouldCopyExtractedFrames("linux")).toBe(false);
  });
});
