import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaFetchError, mediaUrlSourceOptions, reportMediaFetchFailure } from "./mediaFetch";

const URL_WITH_PATH = "http://127.0.0.1:5190/api/projects/demo/preview/clips/take-1.mp4";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mediaUrlSourceOptions", () => {
  it("turns a network failure into a typed error without the URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { fetchFn } = mediaUrlSourceOptions("probe");

    const error = await fetchFn(URL_WITH_PATH).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MediaFetchError);
    expect(error).toMatchObject({ reader: "probe", status: null, code: "TypeError" });
    expect(String((error as Error).message)).not.toContain("take-1");
  });

  it("names the network code when the failure carries one", async () => {
    const failure = Object.assign(new TypeError("fetch failed"), { cause: { code: "EBUSY" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    const error = await mediaUrlSourceOptions("thumbnail")
      .fetchFn(URL_WITH_PATH)
      .catch((e) => e);

    expect(error).toMatchObject({ reader: "thumbnail", code: "EBUSY" });
  });

  it("turns an HTTP error status into a typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));

    const error = await mediaUrlSourceOptions("probe")
      .fetchFn(URL_WITH_PATH)
      .catch((e) => e);

    expect(error).toMatchObject({
      status: 403,
      message: "probe range fetch failed: HTTP 403 after 0 retries",
    });
  });

  it("lets a cancellation through untouched", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(mediaUrlSourceOptions("probe").fetchFn(URL_WITH_PATH)).rejects.toBe(abort);
  });

  it("retries a network failure twice, then gives up and records the retries", () => {
    const { getRetryDelay } = mediaUrlSourceOptions("probe");
    const failure = new MediaFetchError("probe", null, "TypeError");

    expect([1, 2, 3].map((attempt) => getRetryDelay(attempt, failure))).toEqual([0.5, 1, null]);
    expect(failure).toMatchObject({
      retries: 2,
      message: "probe range fetch failed: network TypeError after 2 retries",
    });
  });

  it("gives up on a body that breaks mid-read with the typed error, through a real mediabunny read", async () => {
    const brokenBody = () =>
      new Response(
        new ReadableStream({
          pull: (controller) => controller.error(new TypeError("network error")),
        }),
        {
          status: 206,
          headers: { "Content-Range": "bytes 0-65535/1000000", "Content-Length": "65536" },
        },
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => brokenBody()),
    );
    vi.useFakeTimers();
    const mb = await import("mediabunny");
    const runnerListeners = process.listeners("unhandledRejection");
    const unhandled: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => unhandled.push(reason));
    try {
      const input = new mb.Input({
        source: new mb.UrlSource(URL_WITH_PATH, mediaUrlSourceOptions("thumbnail")),
        formats: mb.ALL_FORMATS,
      });
      const read = input.getDurationFromMetadata().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await read;
      input.dispose();
      await vi.runAllTimersAsync();

      expect(error).toMatchObject({
        name: "MediaFetchError",
        message: "thumbnail range fetch failed: network TypeError after 2 retries",
      });
      for (const reason of unhandled) expect(reason).toBeInstanceOf(MediaFetchError);
    } finally {
      vi.useRealTimers();
      process.removeAllListeners("unhandledRejection");
      for (const listener of runnerListeners) process.on("unhandledRejection", listener);
    }
  });

  it("counts mid-stream read failures, which always arrive as attempt 1", () => {
    const { getRetryDelay } = mediaUrlSourceOptions("thumbnail");
    const readError = new TypeError("network error");

    expect([1, 1, 1].map((attempt) => getRetryDelay(attempt, readError))).toEqual([0.5, 1, null]);
  });

  it("does not retry a client error status", () => {
    const failure = new MediaFetchError("probe", 404, null);

    expect(mediaUrlSourceOptions("probe").getRetryDelay(1, failure)).toBeNull();
    expect(failure.retries).toBe(0);
  });

  // mediabunny rethrows a failed read-ahead nobody awaits "so it doesn't get swallowed": that copy is typed too.
  it("fails a real mediabunny read, and its unawaited read-ahead, with the typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const mb = await import("mediabunny");
    const runnerListeners = process.listeners("unhandledRejection");
    const unhandled: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => unhandled.push(reason));
    try {
      const input = new mb.Input({
        source: new mb.UrlSource(URL_WITH_PATH, mediaUrlSourceOptions("probe")),
        formats: mb.ALL_FORMATS,
      });
      const error = await input.getDurationFromMetadata().catch((e: unknown) => e);
      input.dispose();
      await new Promise(setImmediate);

      expect(error).toMatchObject({ name: "MediaFetchError", status: 404, retries: 0 });
      expect(unhandled.length).toBeGreaterThan(0);
      for (const reason of unhandled) expect(reason).toBeInstanceOf(MediaFetchError);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of runnerListeners) process.on("unhandledRejection", listener);
    }
  });
});

describe("reportMediaFetchFailure", () => {
  it("writes one scrubbed line for a typed failure and nothing for anything else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new MediaFetchError("thumbnail", null, "TypeError");
    failure.setRetries(2);

    reportMediaFetchFailure(failure);
    reportMediaFetchFailure(new Error("Video source has no decodable video track"));

    expect(warn.mock.calls).toEqual([
      ["[Studio] thumbnail range fetch failed: network TypeError after 2 retries"],
    ]);
  });
});
