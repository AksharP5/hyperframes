import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});

describe("createStudioServer autoProxy plumbing", () => {
  const dirs: string[] = [];
  let server: StudioServer | undefined;

  function tmpProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-studio-server-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    server?.watcher.close();
    server = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("hyperframes.json media.autoProxy=false flows through to the adapter", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir });

    expect(server.adapter.autoProxy).toBe(false);
  });

  it("defaults the adapter to autoProxy=true when neither option nor config disables it", () => {
    server = createStudioServer({ projectDir: tmpProject() });
    expect(server.adapter.autoProxy).toBe(true);
  });

  it("an explicit option (the preview command's resolved --proxy flag) wins over config", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir, autoProxy: true });

    expect(server.adapter.autoProxy).toBe(true);
  });
});

describe("host guarding on identity-bearing responses", () => {
  const dirs: string[] = [];
  let server: StudioServer | undefined;

  function tmpProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-studio-host-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    server?.watcher.close();
    server = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // A rebound origin can point its own hostname at 127.0.0.1 and read
  // responses as same-origin. Guarding only /api/telemetry-identity left the
  // SPA route as an open side door: fetching `/` returned the same distinct
  // id and bucket seed inline in the HTML.
  it("omits identity injection from the SPA response for a hostile Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/", { headers: { host: "evil.example.com" } });
    const html = await res.text();
    expect(html).not.toContain("__HF_CLI_DISTINCT_ID");
    expect(html).not.toContain("__HF_CLI_BUCKET_SEED");
    expect(html).not.toContain("__HF_CLI_CANARY_DECISIONS");
    // Studio still loads — only the identity block is withheld. (The env
    // script is empty here: it only emits with VITE_STUDIO_* vars set.)
    expect(res.status).toBe(200);
    expect(html).toContain("<head>");
  });

  it("refuses the identity endpoint for a hostile Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "evil.example.com" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('distinctId":"');
  });

  it("serves the identity endpoint on a loopback Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "127.0.0.1:5173" },
    });
    expect(res.status).toBe(200);
    // The seed is no longer served here at all — Studio gets decisions
    // injected instead, so nothing needs it over HTTP.
    expect(Object.keys((await res.json()) as object)).toEqual(["distinctId"]);
  });
});
