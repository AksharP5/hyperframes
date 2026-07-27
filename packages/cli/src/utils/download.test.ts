import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download.js";

const { unlinkSyncMock } = vi.hoisted(() => ({
  unlinkSyncMock: vi.fn(),
}));

vi.mock("node:https", () => ({ get: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  unlinkSyncMock.mockImplementation(actual.unlinkSync);
  return { ...actual, unlinkSync: unlinkSyncMock };
});

const mockGet = vi.mocked(httpsGet);
const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloadFile", () => {
  it("rejects an idle response and removes the partial file", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    let responseClosed = false;
    unlinkSyncMock.mockImplementation((path) => {
      if (!responseClosed) {
        const error = new Error("file is locked");
        Object.assign(error, { code: "EBUSY" });
        throw error;
      }
      actualFs.unlinkSync(path);
    });

    mockGet.mockImplementation(((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = {};
      response.once("close", () => {
        responseClosed = true;
      });

      class FakeRequest extends EventEmitter {
        private timeout: ReturnType<typeof setTimeout> | undefined;
        private fallback = setTimeout(() => this.destroy(new Error("late shutdown")), 50);
        private destroyed = false;

        setTimeout(ms: number, onTimeout: () => void): this {
          this.timeout = setTimeout(onTimeout, ms);
          return this;
        }

        destroy(error: Error): void {
          if (this.destroyed) return;
          this.destroyed = true;
          clearTimeout(this.timeout);
          clearTimeout(this.fallback);
          response.destroy(error);
          this.emit("error", error);
        }
      }

      const request = new FakeRequest();
      callback(response as unknown as IncomingMessage);
      return request as unknown as ClientRequest;
    }) as typeof httpsGet);

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");

    await expect(
      downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 10 }),
    ).rejects.toThrow("Download timed out after 10ms");
    expect(existsSync(`${dest}.tmp`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });
});
