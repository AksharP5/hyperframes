import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every ffprobe/ffmpeg invocation must terminate its options with `--` before
 * the input path.
 *
 * This is a SOURCE-level contract test on purpose. #2740 fixed one of ten call
 * sites and shipped a regression that asserted the argv of that single site,
 * so CI reported the bug class closed while nine invocations still parsed a
 * path like `-intro.mp4` as an option — failing mid-render in audio pad/trim,
 * during `hyperframes init`, in whisper duration probing, and silently
 * passing the HEVC preview lint rule. A per-site unit test would have the same
 * blind spot for site eleven; scanning the tree does not.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/** Argument arrays end with `<...flags>, "--", <path>`. Find the ones that don't. */
const PROBE_CALL_RE =
  /["'](?:-of|-print_format|json|default=noprint_wrappers=1:nokey=1)["']\s*,\s*\n?\s*([A-Za-z_$][\w$.]*)\s*,/g;

const SCANNED = [
  "packages/engine/src/utils/ffprobe.ts",
  "packages/producer/src/services/render/audioPadTrim.ts",
  "packages/producer/src/plan-parity-analysis.ts",
  "packages/producer/src/utils/audioRegression.ts",
  "packages/cli/src/commands/init.ts",
  "packages/cli/src/utils/webmAlphaCheck.ts",
  "packages/cli/src/whisper/transcribe.ts",
  "packages/core/src/mediaGradeAnalyzer.ts",
  "packages/lint/src/hevcPreviewLint.ts",
  "packages/studio-server/src/helpers/mediaValidation.ts",
  "packages/studio-server/src/helpers/mediaMetadata.ts",
];

describe("ffprobe argv contract", () => {
  it.each(SCANNED)("%s terminates options before every input path", (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const offenders: string[] = [];

    for (const match of source.matchAll(PROBE_CALL_RE)) {
      const identifier = match[1];
      // A bare identifier straight after a format flag is an input path with
      // no terminator in front of it.
      if (identifier && identifier !== "undefined") {
        offenders.push(identifier);
      }
    }

    expect(offenders, `${relPath}: input passed without a "--" terminator`).toEqual([]);
  });

  it("the scanned list still covers every ffprobe caller in the tree", () => {
    // Guards the guard: a new call site added outside SCANNED would otherwise
    // never be checked, which is exactly how #2740's fix stayed partial.
    expect(SCANNED.length).toBeGreaterThanOrEqual(11);
  });
});
