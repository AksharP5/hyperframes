import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchStackOutputs,
  locateSamTemplate,
  parseReservedConcurrency,
  samDeploy,
} from "./sam.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("locateSamTemplate", () => {
  it("returns the template path when it exists under repoRoot", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-lambda-sam-"));
    const samDir = join(dir, "examples", "aws-lambda");
    mkdirSync(samDir, { recursive: true });
    const templatePath = join(samDir, "template.yaml");
    writeFileSync(templatePath, "AWSTemplateFormatVersion: '2010-09-09'\n");

    expect(locateSamTemplate(dir)).toBe(templatePath);
  });

  // No --sam-template flag exists; the error must not send users to one.
  it("does not point users at the nonexistent --sam-template flag when the template is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-lambda-sam-missing-"));

    expect(() => locateSamTemplate(dir!)).toThrow(/HYPERFRAMES_REPO_ROOT/);
    expect(() => locateSamTemplate(dir!)).not.toThrow(/--sam-template/);
  });
});

describe("samDeploy", () => {
  const overrides = () => vi.mocked(spawnSync).mock.lastCall?.[1]?.join(" ") ?? "";

  // An omitted override makes SAM send UsePreviousValue, so a redeploy keeps an existing cap.
  it("sends no ReservedConcurrency when --concurrency is omitted", () => {
    samDeploy({ samDir: "/repo", stackName: "s", region: "us-east-2" });
    expect(overrides()).not.toContain("ReservedConcurrency");
  });

  it("forwards an explicit --concurrency", () => {
    samDeploy({ samDir: "/repo", stackName: "s", region: "us-east-2", reservedConcurrency: 8 });
    expect(overrides()).toContain("ReservedConcurrency=8");
  });
});

describe("fetchStackOutputs", () => {
  const stack = (reserved: string) =>
    JSON.stringify({
      Outputs: [
        { OutputKey: "RenderBucketName", OutputValue: "bucket" },
        { OutputKey: "RenderFunctionArn", OutputValue: "arn:aws:lambda:r:1:function:fn" },
        { OutputKey: "RenderStateMachineArn", OutputValue: "arn:sm" },
      ],
      Parameters: [{ ParameterKey: "ReservedConcurrency", ParameterValue: reserved }],
    });

  it("reports the deployed reservation, and none for -1", () => {
    vi.mocked(execFileSync).mockReturnValue(stack("8"));
    expect(fetchStackOutputs({ stackName: "s", region: "r" }).reservedConcurrency).toBe(8);
    vi.mocked(execFileSync).mockReturnValue(stack("-1"));
    expect(fetchStackOutputs({ stackName: "s", region: "r" }).reservedConcurrency).toBeUndefined();
  });
});

describe("parseReservedConcurrency", () => {
  it("maps none to -1, keeps N, leaves an omitted flag undefined and rejects anything else", () => {
    expect(parseReservedConcurrency("none")).toBe(-1);
    expect(parseReservedConcurrency("8")).toBe(8);
    expect(parseReservedConcurrency(undefined)).toBeUndefined();
    for (const bad of ["abc", "0", "-1", "2.5"]) {
      expect(() => parseReservedConcurrency(bad)).toThrow('positive integer or "none"');
    }
    samDeploy({ samDir: "/repo", stackName: "s", region: "r", reservedConcurrency: -1 });
    expect(vi.mocked(spawnSync).mock.lastCall?.[1]).toContain("ReservedConcurrency=-1");
  });
});
