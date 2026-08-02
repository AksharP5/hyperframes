const MAX_TELEMETRY_STRING_LENGTH = 240;

function truncateTelemetryString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function redactUrlQueryStrings(value: string): string {
  return value.replace(/\b(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?…");
}

/**
 * Path characters we treat as part of a single segment. Space is deliberately
 * excluded: including it would let a match run past the path and swallow the
 * prose after it, and a path with a space still gets its remaining segments
 * redacted, which is the part that carries the identifying information.
 */
const SEGMENT = String.raw`[\w.\-@+()~]+`;

/**
 * Once a match is established as a path, consume the rest of the token.
 * Windows forbids `?` in a filename, so `video.mov?not-a-query` is not a real
 * query string — but stopping at the `?` would emit the remainder verbatim.
 * Redacting to the next delimiter cannot leak; stopping early can.
 */
const TOKEN_TAIL = String.raw`[^\s'")]*`;

/**
 * Absolute path, any root — NOT an allowlist of roots.
 *
 * The previous version enumerated `/Users`, `/home`, `/opt`, `/tmp`… which
 * meant a project on `/data`, `/Volumes/External`, an NFS mount or any root a
 * user invented reached telemetry verbatim. Two or more segments are required
 * so `N/A` and a `24/1` frame rate — both ordinary in ffprobe stderr — are not
 * mistaken for paths.
 *
 * The lookbehind keeps this off URLs: after `https:` the slash is preceded by
 * `:`, the second by `/`, and the path segment by a word character, so no
 * position inside a URL can start a match. URLs are handled above, where the
 * host is kept and only the query is dropped.
 */
const ABSOLUTE_PATH = new RegExp(
  String.raw`(?<![:\w/\\])(?:[A-Za-z]:)?(?:[\\/]${SEGMENT}){2,}${TOKEN_TAIL}`,
  "g",
);

/** `./assets/bgm.mp3`, `../out.wav`, `.\tmp\x` — relative paths leak the same
 *  project structure absolute ones do, and were previously untouched. */
const RELATIVE_PATH = new RegExp(
  String.raw`(?<![\w/\\.])\.{1,2}(?:[\\/]${SEGMENT})+${TOKEN_TAIL}`,
  "g",
);

/**
 * A bare basename with an asset extension. ffprobe reports the input by the
 * name it was given, so a caller that passes a basename (or a path this
 * flattened to its last segment) still names the user's file.
 *
 * The lookbehind excludes a slash so this cannot re-redact the tail of a URL
 * whose host we deliberately keep.
 */
const ASSET_BASENAME =
  /(?<![\w/\\])[\w.\-@+()~]+\.(?:mp4|mov|mkv|webm|avi|m4v|mpe?g|ts|mp3|wav|aac|m4a|flac|ogg|opus|png|jpe?g|gif|webp|svg|html?|json|srt|vtt|ass)\b/gi;

function redactFilePaths(value: string): string {
  return (
    value
      .replace(/file:\/\/[^\s'")]+/g, "[file-url]")
      // Relative BEFORE absolute: `./assets/x.mp3` has an absolute-looking tail
      // (`/assets/x.mp3`), so the absolute rule would consume it and leave the
      // leading `.` stranded outside the redaction.
      .replace(RELATIVE_PATH, "[path]")
      .replace(ABSOLUTE_PATH, "[path]")
      .replace(ASSET_BASENAME, "[file]")
  );
}

export function redactTelemetryString(
  value: string,
  maxLength = MAX_TELEMETRY_STRING_LENGTH,
): string {
  return truncateTelemetryString(redactFilePaths(redactUrlQueryStrings(value)), maxLength);
}
