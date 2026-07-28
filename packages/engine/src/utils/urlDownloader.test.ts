// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicHttpsUrl, downloadToTemp, UrlDownloadError } from "./urlDownloader.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-url-download-"));
  tempDirs.push(dir);
  return dir;
}

function temporaryDownloadEntries(dir: string): string[] {
  return readdirSync(dir).filter(
    (name) => name.includes(".partial-") || name.startsWith(".hf-download-"),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("assertPublicHttpsUrl — SSRF guard", () => {
  it("accepts public HTTPS URLs", () => {
    expect(() =>
      assertPublicHttpsUrl("https://gen-os-static.s3.us-east-2.amazonaws.com/fonts/font.ttf"),
    ).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://cdn.jsdelivr.net/npm/gsap.min.js")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://fonts.gstatic.com/s/font.woff2")).not.toThrow();
  });

  it("rejects http:// (non-HTTPS)", () => {
    expect(() => assertPublicHttpsUrl("http://example.com/font.ttf")).toThrow("Only HTTPS");
  });

  it("rejects AWS IMDS (169.254.169.254)", () => {
    expect(() =>
      assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/"),
    ).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://169.254.169.254/latest/user-data")).toThrow();
  });

  it("rejects loopback (127.x.x.x)", () => {
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://127.1.2.3/secret")).toThrow("private/reserved");
  });

  it("rejects localhost", () => {
    expect(() => assertPublicHttpsUrl("https://localhost/font.ttf")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("http://localhost:3000/secret")).toThrow();
  });

  it("rejects RFC1918 — 10.x", () => {
    expect(() => assertPublicHttpsUrl("https://10.0.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://10.255.255.255/secret")).toThrow("private/reserved");
  });

  it("rejects RFC1918 — 172.16–172.31", () => {
    expect(() => assertPublicHttpsUrl("https://172.16.0.1/secret")).toThrow("private/reserved");
    expect(() => assertPublicHttpsUrl("https://172.31.255.255/secret")).toThrow("private/reserved");
  });

  it("allows 172.0–172.15 and 172.32+ (not RFC1918)", () => {
    expect(() => assertPublicHttpsUrl("https://172.15.0.1/font.ttf")).not.toThrow();
    expect(() => assertPublicHttpsUrl("https://172.32.0.1/font.ttf")).not.toThrow();
  });

  it("rejects RFC1918 — 192.168.x", () => {
    expect(() => assertPublicHttpsUrl("https://192.168.1.1/secret")).toThrow("private/reserved");
  });

  it("rejects unspecified address (0.x)", () => {
    expect(() => assertPublicHttpsUrl("https://0.0.0.0/secret")).toThrow("private/reserved");
  });

  it("rejects loopback IPv6 ([::1])", () => {
    expect(() => assertPublicHttpsUrl("https://[::1]/secret")).toThrow("private/reserved");
  });

  it("rejects normalized reserved IPv6 and IPv4-mapped forms", () => {
    for (const url of [
      "https://[::]/secret",
      "https://[fe80::1]/secret",
      "https://[fc00::1]/secret",
      "https://[::ffff:127.0.0.1]/secret",
      "https://[::ffff:169.254.169.254]/latest/meta-data/",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow("private/reserved");
    }
  });

  it("rejects CGNAT and other non-public IPv4 ranges", () => {
    for (const url of [
      "https://100.64.0.1/secret",
      "https://198.18.0.1/secret",
      "https://192.0.2.1/secret",
      "https://224.0.0.1/secret",
      "https://240.0.0.1/secret",
      "https://255.255.255.255/secret",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow("private/reserved");
    }
  });

  it("rejects invalid URLs", () => {
    expect(() => assertPublicHttpsUrl("not-a-url")).toThrow("Invalid URL");
    expect(() => assertPublicHttpsUrl("")).toThrow("Invalid URL");
  });
});

describe("downloadToTemp atomic publication and bounded retry", () => {
  it("follows a bounded redirect only after validating the next public HTTPS hop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://media.example/final.mp4" },
        }),
      )
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/redirect.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://media.example/final.mp4",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects a public redirect to a private host before issuing the second request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/private-redirect.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_rejected",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("rejects an IPv4-mapped IMDS redirect before issuing the second request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://[::ffff:169.254.169.254]/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/mapped-private-redirect.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_rejected",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries one HTTP 503 and publishes only the complete final file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const onTransientRetry = vi.fn();

    const path = await downloadToTemp(
      "https://cdn.example/retry-503.mp4",
      dir,
      1_000,
      undefined,
      onTransientRetry,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTransientRetry).toHaveBeenCalledOnce();
    expect(onTransientRetry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "http_transient", retryable: true }),
    );
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("cancels a streaming HTTP error body before retrying", async () => {
    let errorBodyCancelled = false;
    const errorBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("error details"));
      },
      cancel() {
        errorBodyCancelled = true;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(errorBody, { status: 503, statusText: "Service Unavailable" }),
      )
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/streaming-503.mp4", dir, 1_000);

    expect(errorBodyCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not retry a deterministic 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/missing-404.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_not_found",
      retryable: false,
      status: 404,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("exhausts the transient retry budget after exactly one retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, statusText: "Service Unavailable" }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    await expect(
      downloadToTemp("https://cdn.example/always-503.mp4", dir, 1_000),
    ).rejects.toMatchObject({
      kind: "http_transient",
      retryable: true,
      status: 503,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("removes a partial body after a network reset before retrying", async () => {
    const resetBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        controller.error(error);
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(resetBody))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/reset-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries an Undici mid-body disconnect reported through a nested cause", async () => {
    const disconnectedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        const cause = Object.assign(new Error("other side closed"), {
          code: "UND_ERR_SOCKET",
        });
        controller.error(new TypeError("terminated", { cause }));
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(disconnectedBody))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/undici-reset-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("keeps the deadline active through a stalled response body", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const stalledBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(stalledBody);
      })
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/stalled-body.mp4", dir, 20);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries a zero-byte 200 response without publishing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/empty-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("retries a 200 response with no body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const path = await downloadToTemp("https://cdn.example/null-body-once.mp4", dir, 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("removes a stale zero-byte final file before downloading", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("complete"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const stalePath = join(dir, "download_eda0de5dc5a3.mp4");
    writeFileSync(stalePath, "");

    const path = await downloadToTemp("https://cdn.example/stale-empty.mp4", dir, 1_000);

    expect(path).toBe(stalePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not trust a nonempty symlink at the final cache path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("downloaded"));
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const target = join(dir, "attacker-controlled.mp4");
    const cachePath = join(dir, "download_eda0de5dc5a3.mp4");
    writeFileSync(target, "not-the-download");
    symlinkSync(target, cachePath);

    const path = await downloadToTemp("https://cdn.example/stale-empty.mp4", dir, 1_000);

    expect(path).toBe(cachePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("downloaded");
    expect(readFileSync(target, "utf8")).toBe("not-the-download");
  });

  it("does not retry caller cancellation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadToTemp("https://cdn.example/cancelled.mp4", dir, 1_000, controller.signal),
    ).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("deduplicates concurrent callers for the same URL and destination", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("complete")), 10);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const [first, second] = await Promise.all([
      downloadToTemp("https://cdn.example/concurrent.mp4", dir, 1_000),
      downloadToTemp("https://cdn.example/concurrent.mp4", dir, 1_000),
    ]);

    expect(first).toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let one caller cancellation abort another caller", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(body);
      })
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("complete")), 10);
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const first = downloadToTemp(
      "https://cdn.example/cancellation-isolation-a.mp4",
      dir,
      1_000,
      firstController.signal,
    );
    const second = downloadToTemp(
      "https://cdn.example/cancellation-isolation-a.mp4",
      dir,
      1_000,
      secondController.signal,
    );
    firstController.abort();

    await expect(first).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    const path = await second;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });

  it("does not let a later caller cancellation abort the first caller", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response("complete")), 10);
          }),
      )
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(body);
      });
    vi.stubGlobal("fetch", fetchMock);
    const dir = makeTempDir();

    const first = downloadToTemp(
      "https://cdn.example/cancellation-isolation-b.mp4",
      dir,
      1_000,
      firstController.signal,
    );
    const second = downloadToTemp(
      "https://cdn.example/cancellation-isolation-b.mp4",
      dir,
      1_000,
      secondController.signal,
    );
    secondController.abort();

    await expect(second).rejects.toMatchObject({
      kind: "cancelled",
      retryable: false,
    } satisfies Partial<UrlDownloadError>);
    const path = await first;
    expect(readFileSync(path, "utf8")).toBe("complete");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(temporaryDownloadEntries(dir)).toEqual([]);
  });
});
