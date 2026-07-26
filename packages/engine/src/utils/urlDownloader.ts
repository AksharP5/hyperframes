import {
  closeSync,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, extname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const inFlightDownloads = new Map<string, Promise<string>>();
const signalScopes = new WeakMap<AbortSignal, number>();
let nextSignalScope = 1;

function signalScopeKey(signal: AbortSignal | undefined): string {
  if (!signal) return "none";
  let scope = signalScopes.get(signal);
  if (scope === undefined) {
    scope = nextSignalScope;
    nextSignalScope += 1;
    signalScopes.set(signal, scope);
  }
  return String(scope);
}

export type UrlDownloadFailureKind =
  | "cancelled"
  | "timeout"
  | "http_not_found"
  | "http_rejected"
  | "http_transient"
  | "network"
  | "empty_body"
  | "filesystem";

export class UrlDownloadError extends Error {
  constructor(
    readonly kind: UrlDownloadFailureKind,
    readonly retryable: boolean,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UrlDownloadError";
  }
}

function classifyHttpFailure(status: number, statusText: string): UrlDownloadError {
  const message = `HTTP ${status}: ${statusText}`;
  if (status === 404 || status === 410) {
    return new UrlDownloadError("http_not_found", false, message, status);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new UrlDownloadError("http_transient", true, message, status);
  }
  return new UrlDownloadError("http_rejected", false, message, status);
}

function classifyDownloadFailure(error: unknown): UrlDownloadError {
  if (error instanceof UrlDownloadError) return error;
  const message = error instanceof Error ? error.message : String(error);
  let current: unknown = error;
  // Undici often wraps a mid-body socket failure as `TypeError: terminated`
  // with the actionable `UND_ERR_*` code on `cause`.
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (isRetryableNetworkCause(current)) {
      return new UrlDownloadError("network", true, `Download failed: ${message}`);
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return new UrlDownloadError("filesystem", false, `Download failed: ${message}`);
}

const RETRYABLE_NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]);

function isRetryableNetworkCause(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  return (
    RETRYABLE_NETWORK_CODES.has(code) ||
    code.startsWith("UND_ERR_") ||
    /fetch failed|network|socket|connection reset|terminated/i.test(message)
  );
}

// SSRF guard: these prefixes identify non-public address space that
// compositions (customer-supplied) must never be able to reach via the
// download path. Blocks AWS IMDS (169.254.169.254), loopback, RFC1918,
// and unspecified addresses. All comparisons are on the raw hostname
// string; DNS resolution is NOT performed here, so DNS-rebinding bypasses
// are not closed by this check — that gap is acceptable for the risk level.
const BLOCKED_HOST_PREFIXES = [
  "169.254.", // link-local / AWS IMDS
  "127.", // loopback IPv4
  "10.", // RFC1918
  "192.168.", // RFC1918
  "0.", // unspecified
  "[::1]", // loopback IPv6
  "[fc", // RFC4193 unique-local IPv6
  "[fd", // RFC4193 unique-local IPv6
];
// 172.16.0.0 – 172.31.255.255 (RFC1918)
const BLOCKED_172_RANGE = { min: 16, max: 31 };

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  if (BLOCKED_HOST_PREFIXES.some((p) => h.startsWith(p))) return true;
  // 172.16–172.31
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const octet = parseInt(m[1] ?? "0", 10);
    if (octet >= BLOCKED_172_RANGE.min && octet <= BLOCKED_172_RANGE.max) return true;
  }
  return false;
}

/**
 * Validate that a URL is safe to fetch on behalf of customer-supplied
 * compositions. Throws if the URL is non-HTTPS or targets a private/reserved
 * address range (SSRF guard).
 */
export function assertPublicHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[URLDownloader] Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `[URLDownloader] Only HTTPS URLs are permitted in compositions (got ${parsed.protocol}): ${url}`,
    );
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(
      `[URLDownloader] URL targets a private/reserved address and is not permitted: ${url}`,
    );
  }
}

function getFilenameFromUrl(url: string): string {
  const hash = createHash("md5").update(url).digest("hex").slice(0, 12);
  const urlObj = new URL(url);
  const ext = extname(urlObj.pathname) || ".mp4";
  return `download_${hash}${ext}`;
}

function hasCompleteFile(path: string): boolean {
  if (!existsSync(path)) return false;
  if (statSync(path).size > 0) return true;
  // Old versions wrote directly to the final path and could leave an empty
  // file behind. Never trust that stale cache entry.
  rmSync(path, { force: true });
  return false;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function assertAllowedDownloadUrl(url: string, redirect: boolean): void {
  try {
    assertPublicHttpsUrl(url);
  } catch {
    throw new UrlDownloadError(
      "http_rejected",
      false,
      redirect ? "Download redirect target is not permitted" : "Download URL is not permitted",
    );
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect validation remains authoritative if teardown also fails.
  }
}

function resolveRedirectUrl(response: Response, currentUrl: string, redirects: number): string {
  if (redirects >= MAX_REDIRECTS) {
    throw new UrlDownloadError("http_rejected", false, "Download exceeded redirect limit");
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new UrlDownloadError(
      "http_rejected",
      false,
      "Download redirect omitted a Location header",
    );
  }
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new UrlDownloadError("http_rejected", false, "Download redirect Location is invalid");
  }
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  controller: AbortController,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; ; redirects += 1) {
    assertAllowedDownloadUrl(currentUrl, redirects > 0);

    // lgtm[js/file-access-to-http] — every redirect hop is fetched manually
    // only after the HTTPS/private-host guard above; automatic redirect
    // following is disabled so an allowed host cannot bounce into IMDS.
    const response = await fetch(currentUrl, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    await cancelResponseBody(response);
    currentUrl = resolveRedirectUrl(response, currentUrl, redirects);
  }
}

async function fetchToPartial(
  url: string,
  partialPath: string,
  controller: AbortController,
): Promise<void> {
  const response = await fetchWithValidatedRedirects(url, controller);
  if (!response.ok) {
    // Do not leave a streaming error response holding an Undici connection
    // while the bounded retry starts.
    try {
      await response.body?.cancel();
    } catch {
      // The HTTP status remains the useful failure if teardown also fails.
    }
    throw classifyHttpFailure(response.status, response.statusText);
  }
  if (!response.body) {
    throw new UrlDownloadError("empty_body", true, "Download response body is empty");
  }

  const fileStream = createWriteStream(partialPath, { flags: "wx" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readableStream = Readable.fromWeb(response.body as any);
  await pipeline(readableStream, fileStream);
  if (statSync(partialPath).size === 0) {
    throw new UrlDownloadError("empty_body", true, "Download response body contained zero bytes");
  }
}

function syncAndPublishPartial(partialPath: string, localPath: string): void {
  // Windows rejects fsync on a read-only handle (EPERM); the partial is ours
  // and writable, so r+ preserves the same flush semantics cross-platform.
  const fd = openSync(partialPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Different cancellation scopes intentionally do not share a physical
  // request. If another complete attempt won the final-path race, reuse it.
  if (hasCompleteFile(localPath)) return;
  try {
    renameSync(partialPath, localPath);
  } catch (error) {
    if (!hasCompleteFile(localPath)) throw error;
  }
}

async function runDownloadAttempt(
  url: string,
  localPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  // A private, unguessable directory prevents symlink planting and keeps the
  // partial on the destination filesystem so the final rename stays atomic.
  const attemptDir = mkdtempSync(join(dirname(localPath), ".hf-download-"));
  const partialPath = join(attemptDir, "payload");
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = signal?.aborted ?? false;
  const onCallerAbort = (): void => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Download cancelled");
    }
    await fetchToPartial(url, partialPath, controller);
    syncAndPublishPartial(partialPath, localPath);
    return localPath;
  } catch (error) {
    if (callerAborted) {
      throw new UrlDownloadError("cancelled", false, "Download cancelled");
    }
    if (timedOut) {
      throw new UrlDownloadError("timeout", true, `Download timeout after ${timeoutMs / 1000}s`);
    }
    throw classifyDownloadFailure(error);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onCallerAbort);
    controller.abort();
    rmSync(attemptDir, { recursive: true, force: true });
  }
}

async function downloadWithRetry(
  url: string,
  localPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const maxTransientRetries = 1;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runDownloadAttempt(url, localPath, timeoutMs, signal);
    } catch (error) {
      const classified = classifyDownloadFailure(error);
      if (!classified.retryable || attempt >= maxTransientRetries) throw classified;
    }
  }
}

export async function downloadToTemp(
  url: string,
  destDir: string,
  timeoutMs: number = 300000,
  signal?: AbortSignal,
): Promise<string> {
  // Reject non-HTTPS URLs and private/reserved address ranges before
  // touching the cache or filesystem — customer-supplied compositions must
  // not be able to trigger outbound fetches to internal infrastructure.
  assertPublicHttpsUrl(url);

  const cacheKey = `${url}\0${destDir}`;
  // The physical request may be shared only by callers with the same
  // cancellation scope and deadline. Otherwise the first caller's abort or
  // timeout would incorrectly own every waiter.
  const inFlightKey = `${cacheKey}\0${timeoutMs}\0${signalScopeKey(signal)}`;
  const inFlight = inFlightDownloads.get(inFlightKey);
  if (inFlight) {
    return inFlight;
  }

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const filename = getFilenameFromUrl(url);
  const localPath = join(destDir, filename);

  if (hasCompleteFile(localPath)) return localPath;

  const downloadPromise = downloadWithRetry(url, localPath, timeoutMs, signal);
  const trackedDownload = downloadPromise.finally(() => {
    inFlightDownloads.delete(inFlightKey);
  });
  inFlightDownloads.set(inFlightKey, trackedDownload);
  return trackedDownload;
}

export function isHttpUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}
