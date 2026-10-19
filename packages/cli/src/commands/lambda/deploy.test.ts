import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("./repoRoot.js", () => ({ repoRoot: () => root.value }));
vi.mock("@hyperframes/aws-lambda/sdk", () => ({ prebuiltHandler: () => undefined }));
vi.mock("./sam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sam.js")>()),
  samDeploy: vi.fn(),
  fetchStackOutputs: vi.fn(() => ({ bucketName: "b", functionName: "f", stateMachineArn: "s" })),
}));
vi.mock("./state.js", () => ({ DEFAULT_STACK_NAME: "hf", writeStackOutputs: () => "state.json" }));

const { runDeploy } = await import("./deploy.js");
const { samDeploy } = await import("./sam.js");

let dir: string | undefined;
let quiet: { mockRestore(): void };

beforeEach(() => {
  vi.mocked(samDeploy).mockClear();
  quiet = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  root.value = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("runDeploy", () => {
  it("outside a checkout with no pinned handler, fails with the one message before running SAM", async () => {
    await expect(runDeploy()).rejects.toThrow(
      /no prebuilt Lambda handler is available[\s\S]*Docs:/,
    );
    expect(samDeploy).not.toHaveBeenCalled();
  });

  it("outside a checkout, refuses a Chrome source the prebuilt handler does not bundle", async () => {
    await expect(runDeploy({ chromeSource: "chrome-headless-shell" })).rejects.toThrow(
      /needs a hyperframes checkout/,
    );
    expect(samDeploy).not.toHaveBeenCalled();
  });

  it("inside a checkout, deploys the checkout's template as before", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-deploy-checkout-"));
    const samDir = join(dir, "examples", "aws-lambda");
    mkdirSync(samDir, { recursive: true });
    writeFileSync(join(samDir, "template.yaml"), "Resources: {}\n");
    mkdirSync(join(dir, "packages", "aws-lambda", "dist"), { recursive: true });
    writeFileSync(join(dir, "packages", "aws-lambda", "dist", "handler.zip"), "zip");
    root.value = dir;

    await runDeploy({ skipBuild: true });
    expect(vi.mocked(samDeploy).mock.calls[0]?.[0]).toMatchObject({ samDir });
  });
});
