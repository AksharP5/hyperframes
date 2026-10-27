import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tarGz = (() => {
  const dir = mkdtempSync(join(tmpdir(), "fetch-src-"));
  writeFileSync(join(dir, "hello.txt"), "hi");
  const out = join(dir, "pkg.tar.gz");
  Bun.spawnSync(["tar", "-czf", out, "-C", dir, "hello.txt"]);
  return readFileSync(out);
})();

async function fetchAfterResets(resets: number) {
  let hits = 0;
  const server = createServer((socket) => {
    socket.once("data", () => {
      if (++hits <= resets) return socket.resetAndDestroy();
      socket.write(
        `HTTP/1.1 200 OK\r\nContent-Length: ${tarGz.length}\r\nConnection: close\r\n\r\n`,
      );
      socket.end(tarGz);
    });
  }).listen(0, "127.0.0.1");
  const { port } = server.address() as { port: number };
  const dir = mkdtempSync(join(tmpdir(), "fetch-run-"));
  const sum = createHash("sha256").update(tarGz).digest("hex");
  writeFileSync(
    join(dir, "sources.txt"),
    `pkg.tar.gz ${sum} http://127.0.0.1:${port}/pkg.tar.gz\n`,
  );
  const proc = Bun.spawn(
    ["bash", "-c", `set -euo pipefail; source ${import.meta.dir}/fetch.sh; fetch pkg.tar.gz`],
    {
      env: { ...process.env, SRC: dir, SOURCES: join(dir, "sources.txt") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const code = await proc.exited;
  server.close();
  return { code, hits, extracted: readFileSync(join(dir, "hello.txt"), "utf8") };
}

describe("ffmpeg image fetch", () => {
  it("retries a reset connection and still checks the sha256", async () => {
    const r = await fetchAfterResets(2);
    expect(r).toMatchObject({ code: 0, hits: 3, extracted: "hi" });
  }, 30_000);
});
