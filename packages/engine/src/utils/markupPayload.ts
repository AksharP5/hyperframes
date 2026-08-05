import { createHash } from "node:crypto";
import { open as openFile } from "node:fs/promises";

export const MARKUP_NOT_MEDIA = "MARKUP_NOT_MEDIA" as const;

/** Cap the joined fingerprint list so the message stays bounded. */
const MAX_LISTED_FINGERPRINTS = 8;

/**
 * Thrown when a file behind a `<video>`/`<audio>` src is a markup document
 * (HTML, XML, SVG) rather than a media container.
 *
 * Motivating incident: STUDIO-5433 — an authoring bug produced an a-roll
 * element whose src pointed at a `streamed-preview.html` URL that downloaded
 * to a legitimate 6.5 KB `<!DOCTYPE html>` page instead of the expected MP4.
 * ffprobe's `[mov,mp4,m4a,3gp,3g2,mj2 @ ...] moov atom not found` masked the
 * cause (the `mov,mp4,…` prefix is ffprobe's demuxer probe order, not the
 * file's true format), so the alert routed as an ffmpeg/codec bug.
 *
 * Deliberately says nothing about *why* the payload is markup: an unresolved
 * nested-composition URL and a CDN error page served with a 200 both land
 * here, and naming only the first sends on-call after the wrong cause.
 *
 * Message discipline mirrors `AssetMediaTypeMismatchError`: bounded text with
 * hashed element correlation keys, never the authored src or the payload's own
 * bytes — producer forwards `error.message` to API clients.
 */
export class MarkupNotMediaError extends Error {
  readonly code = MARKUP_NOT_MEDIA;
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly elementFingerprints: readonly string[];

  constructor(elementFingerprints: readonly string[]) {
    const listed = elementFingerprints.slice(0, MAX_LISTED_FINGERPRINTS).join(",");
    const elided = elementFingerprints.length - MAX_LISTED_FINGERPRINTS;
    super(
      `${elementFingerprints.length} media source(s) are markup documents (HTML/XML), not media ` +
        `containers [elements=${listed}${elided > 0 ? `,+${elided}` : ""}]. Either an unresolved ` +
        "nested-composition preview URL was authored as a media src, or the source answered with " +
        "an HTML/XML error page (expired signed URL, or a 403/404 body served as 200).",
    );
    this.name = "MarkupNotMediaError";
    this.elementFingerprints = elementFingerprints;
  }
}

/** Stable, bounded correlation key. Never the raw element id or source. */
export function fingerprintElementId(elementId: string): string {
  return createHash("sha256").update(elementId).digest("hex").slice(0, 16);
}

const SNIFF_BYTES = 512;
const ASCII_LT = 0x3c;
// NUL is skippable so UTF-16-encoded markup (`3C 00 68 00 …`) is caught, and so
// is a payload padded with NULs. No supported container is defeated by this:
// mp4/mov open with a box size whose first non-NUL byte is the size itself, and
// MPEG-PS `00 00 01 BA` stops at 0x01.
const SKIPPABLE_LEADING_BYTES = new Set([0x00, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const BYTE_ORDER_MARKS = [
  Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8
  Buffer.from([0xff, 0xfe]), // UTF-16 LE
  Buffer.from([0xfe, 0xff]), // UTF-16 BE
];

function byteOrderMarkLength(head: Buffer): number {
  for (const mark of BYTE_ORDER_MARKS) {
    if (head.length >= mark.length && head.subarray(0, mark.length).equals(mark)) {
      return mark.length;
    }
  }
  return 0;
}

/** Read up to {@link SNIFF_BYTES} from the front of the file. */
async function readHead(filePath: string): Promise<Buffer> {
  const fh = await openFile(filePath, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    let filled = 0;
    // Looped because a single read can come back short on NFS/FUSE and on
    // FIFOs, which would truncate the window mid-prefix.
    while (filled < buf.length) {
      const { bytesRead } = await fh.read(buf, filled, buf.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buf.subarray(0, filled);
  } finally {
    await fh.close().catch(() => {});
  }
}

function startsWithMarkupByte(head: Buffer): boolean {
  for (let index = byteOrderMarkLength(head); index < head.length; index++) {
    const byte = head[index];
    if (byte === undefined) break;
    if (SKIPPABLE_LEADING_BYTES.has(byte)) continue;
    return byte === ASCII_LT;
  }
  // Empty or all-whitespace: not this classifier's call.
  return false;
}

/**
 * True when the file's first meaningful byte is `<` — i.e. the payload is a
 * markup document, not a media container. BOM- and whitespace-tolerant.
 *
 * One prefix byte replaces an allowlist of markup shapes: `<!doctype`,
 * `<html`, `<?xml`, a prolog-less `<svg`, and an S3 `<Error>` body all begin
 * with `<`, and no container this pipeline supports does — mp4/mov start with
 * a box size, Matroska/WebM `1A 45 DF A3`, Ogg `OggS`, RIFF `RIFF`, MPEG-TS
 * `0x47`, FLAC `fLaC`, ADTS `FF Fx`, MP3 `ID3`. An allowlist would need a new
 * entry every time a new payload shape shows up in production.
 *
 * Never throws: this is a classifier, not a gate. An unreadable file (EACCES,
 * EISDIR, a temp file evicted between `existsSync` and here) reports "not
 * markup" so the real probe still produces the real error, exactly as it did
 * before the sniff existed.
 */
export async function isMarkupPayload(filePath: string): Promise<boolean> {
  try {
    return startsWithMarkupByte(await readHead(filePath));
  } catch {
    return false;
  }
}

/**
 * Throw {@link MarkupNotMediaError} if `filePath` is a markup payload.
 *
 * Only for sources whose element type can never legitimately be markup —
 * `<video>` and `<audio>`. An `<img>` src may be an SVG, which ffprobe reads
 * through its `svg_pipe` demuxer, so image sources must not be sniffed.
 */
export async function assertNotMarkupPayload(filePath: string, elementId: string): Promise<void> {
  if (await isMarkupPayload(filePath)) {
    throw new MarkupNotMediaError([fingerprintElementId(elementId)]);
  }
}
