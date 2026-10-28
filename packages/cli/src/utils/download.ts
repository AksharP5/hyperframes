import { randomUUID } from "node:crypto";
import { createWriteStream, renameSync, statSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { once } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
  /** Reject before writing more than this many response bytes. */
  maxBytes?: number;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  /** Aborting it destroys the request and removes the partial file. */
  signal?: AbortSignal;
}

/** Every redirect a host may reasonably answer with, not just the two we saw first. */
export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Where a redirect actually points.
 *
 * Split out because this is the part that was wrong, and it is the part that
 * can be checked without a socket: hosts answer with relative locations
 * (`/api/resolve-cache/...`) far more often than the original code assumed, and
 * handing that string back as a request target fails.
 */
export function redirectTarget(location: string, from: string): string {
  return new URL(location, from).toString();
}

/** Enough hops for a CDN handoff, few enough that a redirect loop still ends. */
const MAX_REDIRECTS = 10;

function removePartialFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/locked partial files are handled by the next atomic download.
  }
}

function measureDownload(options: DownloadOptions, startBytes: number, totalBytes: number | null) {
  let receivedBytes = startBytes;
  let reportedAt = Date.now();
  options.onProgress?.(receivedBytes, totalBytes);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      if (options.maxBytes !== undefined && receivedBytes > options.maxBytes) {
        callback(new Error(`Download exceeded ${options.maxBytes} bytes`));
        return;
      }
      const now = Date.now();
      if (now - reportedAt >= 100) {
        options.onProgress?.(receivedBytes, totalBytes);
        reportedAt = now;
      }
      callback(null, chunk);
    },
  });
  return {
    stream,
    received: () => receivedBytes,
    complete: () => options.onProgress?.(receivedBytes, totalBytes),
  };
}

function getUrl(
  url: string,
  signal: AbortSignal | undefined,
  offset: number,
  onResponse: (res: IncomingMessage) => void,
): ClientRequest {
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : undefined;
  if (!signal && !headers) return httpsGet(url, onResponse);
  return httpsGet(
    url,
    { ...(signal ? { signal } : {}), ...(headers ? { headers } : {}) },
    onResponse,
  );
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function byteCount(value: string | undefined): number | null {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Where a 206 body starts and the whole file's size, from `Content-Range: bytes start-end/total`. */
function contentRange(header: string | undefined): { start: number; total: number | null } | null {
  const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(header ?? "");
  return match
    ? { start: Number(match[1]), total: match[2] === "*" ? null : Number(match[2]) }
    : null;
}

type ResponsePlan =
  | { kind: "redirect"; location: string }
  | { kind: "body"; start: number; total: number | null; append: boolean }
  | { kind: "refuse"; status: number | undefined };

/** What to do with a response to a request for the bytes from `offset` on. */
function planResponse(res: IncomingMessage, offset: number): ResponsePlan {
  const status = res.statusCode;
  const location = res.headers.location;
  if (status && REDIRECT_CODES.has(status) && location) return { kind: "redirect", location };
  const range = status === 206 ? contentRange(res.headers["content-range"]) : null;
  if (offset > 0 && range?.start === offset) {
    return { kind: "body", start: offset, total: range.total, append: true };
  }
  // A 200, including one to a range request, is the whole file from byte 0.
  if (status === 200) {
    return {
      kind: "body",
      start: 0,
      total: byteCount(res.headers["content-length"]),
      append: false,
    };
  }
  return { kind: "refuse", status };
}

/** Writes a response body to `tmp`, leaving `state.received` at the bytes that reached disk. */
async function writeBody(
  res: IncomingMessage,
  tmp: string,
  plan: Extract<ResponsePlan, { kind: "body" }>,
  state: { received: number; total: number | null },
  options: DownloadOptions,
): Promise<void> {
  state.received = plan.start;
  state.total = plan.total;
  const meter = measureDownload(options, plan.start, plan.total);
  const file = createWriteStream(tmp, { flags: plan.append ? "a" : "w" });
  try {
    await pipeline(res, meter.stream, file);
  } catch (error) {
    // Chunks still buffered in the destroyed file stream never reach disk.
    if (!file.closed) await once(file, "close").catch(() => {});
    state.received = fileSize(tmp);
    throw error;
  }
  state.received = meter.received();
  meter.complete();
}

/** One request chain; `state.received` holds the bytes in `tmp` even when it rejects. */
function downloadAttempt(
  url: string,
  tmp: string,
  state: { received: number; total: number | null },
  options: DownloadOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const offset = state.received;
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0) => {
      let activeResponse: IncomingMessage | undefined;
      let responseDiscarded = false;
      let responsePipelineStarted = false;
      let requestError: Error | undefined;
      const discard = (res: IncomingMessage) => {
        responseDiscarded = true;
        res.destroy();
      };
      const onResponse = (res: IncomingMessage) => {
        activeResponse = res;
        const plan = planResponse(res, offset);
        if (plan.kind === "refuse") {
          discard(res);
          reject(new Error(`Download failed: HTTP ${plan.status}`));
        } else if (plan.kind === "redirect") {
          discard(res);
          if (hops >= MAX_REDIRECTS) {
            reject(
              new Error(
                `Download failed: more than ${MAX_REDIRECTS} redirects from ${url.split("?")[0]}`,
              ),
            );
          } else {
            try {
              follow(redirectTarget(plan.location, u), hops + 1);
            } catch (error) {
              reject(error);
            }
          }
        } else {
          responsePipelineStarted = true;
          writeBody(res, tmp, plan, state, options).then(resolve, (err) =>
            reject(requestError ?? err),
          );
        }
      };
      let request: ClientRequest;
      try {
        request = getUrl(u, options.signal, offset, onResponse);
      } catch (error) {
        reject(error);
        return;
      }
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
      });
      request.on("error", (err) => {
        if (responseDiscarded) return;
        if (responsePipelineStarted) {
          requestError = err;
          activeResponse?.destroy(err);
          return;
        }
        reject(err);
      });
    };
    follow(url);
  });
}

/** Some networks drop every connection at the same byte, so a retry resumes from the partial file. */
export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const state: { received: number; total: number | null } = { received: 0, total: null };
  for (;;) {
    const before = state.received;
    try {
      await downloadAttempt(url, tmp, state, options);
      const size = fileSize(tmp);
      if (state.total !== null && size !== state.total) {
        state.received = size;
        throw new Error(`Download incomplete: ${size} of ${state.total} bytes`);
      }
      renameSync(tmp, dest);
      return;
    } catch (error) {
      const overLimit = error instanceof Error && error.message.startsWith("Download exceeded");
      if (options.signal?.aborted || overLimit || state.received <= before) {
        removePartialFile(tmp);
        throw error;
      }
    }
  }
}
