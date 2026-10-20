import { TimeoutError, type Browser } from "puppeteer-core";
import { describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome } from "./chromeTestUtils";

vi.mock("../vite.browser", () => ({ findSystemChrome: () => "/test/chrome" }));

const fakeBrowser = (close: () => Promise<void>) => {
  const kill = vi.fn();
  const disconnect = vi.fn(async () => undefined);
  const browser = { close, disconnect, process: () => ({ kill }) } as unknown as Browser;
  return { browser, kill, disconnect };
};

describe("closeTestChrome", () => {
  it("kills a Chrome whose close never finishes", async () => {
    const { browser, kill, disconnect } = fakeBrowser(() => new Promise(() => undefined));
    await closeTestChrome(browser, 0);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("leaves a Chrome that closed alone", async () => {
    const { browser, kill } = fakeBrowser(async () => undefined);
    await closeTestChrome(browser, 60_000);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("launchTestChrome", () => {
  it("bounds each launch and tries once more after a stuck one", async () => {
    const { browser } = fakeBrowser(async () => undefined);
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError("stuck"))
      .mockResolvedValueOnce(browser);
    await expect(launchTestChrome(launch)).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch.mock.calls[0]![0]).toMatchObject({ timeout: 20_000 });
  });

  it("tries once more after a stuck launch that Windows reports as already running", async () => {
    vi.useFakeTimers();
    try {
      const { browser } = fakeBrowser(async () => undefined);
      const launch = vi
        .fn()
        .mockImplementationOnce(async () => {
          vi.advanceTimersByTime(20_000);
          throw new Error("The browser is already running for C:\\tmp\\x");
        })
        .mockResolvedValueOnce(browser);
      await expect(launchTestChrome(launch)).resolves.toBe(browser);
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a launch that failed for another reason", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("no such file"));
    await expect(launchTestChrome(launch)).rejects.toThrow("no such file");
    expect(launch).toHaveBeenCalledOnce();
  });
});
