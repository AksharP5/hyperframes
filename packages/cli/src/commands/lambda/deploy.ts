/**
 * `hyperframes lambda deploy` — build the handler ZIP (or, outside a
 * checkout, fetch the adapter's pinned prebuilt one), sam-deploy the
 * Phase 6a SAM template, and persist the stack outputs locally so the
 * other lambda subcommands don't need re-derive them.
 *
 * Idempotent: re-running points at the same stack name and SAM resolves
 * the changeset to a no-op when nothing changed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { c } from "../../ui/colors.js";
import { stagePrebuiltHandler } from "./prebuiltHandler.js";
import { fetchStackOutputs, locateSamTemplate, samDeploy } from "./sam.js";
import { repoRoot } from "./repoRoot.js";
import { DEFAULT_STACK_NAME, writeStackOutputs } from "./state.js";

export interface DeployArgs {
  stackName: string;
  region: string;
  awsProfile?: string;
  /** -1 removes the reservation. Omitted: a redeploy keeps it; a new stack reserves none. */
  reservedConcurrency?: number;
  chromeSource: "sparticuz" | "chrome-headless-shell";
  lambdaMemoryMb: number;
  /** Override the handler-ZIP rebuild step. Useful for CI runs that already built it. */
  skipBuild: boolean;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MEMORY_MB = 10240;

export async function runDeploy(args: Partial<DeployArgs> = {}): Promise<void> {
  const resolved: DeployArgs = {
    stackName: args.stackName ?? DEFAULT_STACK_NAME,
    region: args.region ?? process.env.AWS_REGION ?? DEFAULT_REGION,
    awsProfile: args.awsProfile ?? process.env.AWS_PROFILE,
    reservedConcurrency: args.reservedConcurrency,
    chromeSource: args.chromeSource ?? "sparticuz",
    lambdaMemoryMb: args.lambdaMemoryMb ?? DEFAULT_MEMORY_MB,
    skipBuild: args.skipBuild ?? false,
  };

  const samDir = await prepareSamDir(repoRoot(), resolved);

  console.log(c.dim(`→ sam deploy (stack=${resolved.stackName} region=${resolved.region})`));
  samDeploy({
    samDir,
    stackName: resolved.stackName,
    region: resolved.region,
    awsProfile: resolved.awsProfile,
    reservedConcurrency: resolved.reservedConcurrency,
    lambdaMemoryMb: resolved.lambdaMemoryMb,
    chromeSource: resolved.chromeSource,
  });

  console.log(c.dim("→ Reading stack outputs"));
  const outputs = fetchStackOutputs({
    stackName: resolved.stackName,
    region: resolved.region,
    awsProfile: resolved.awsProfile,
  });

  const statePath = writeStackOutputs({
    stackName: resolved.stackName,
    region: resolved.region,
    bucketName: outputs.bucketName,
    stateMachineArn: outputs.stateMachineArn,
    functionName: outputs.functionName,
    lambdaMemoryMb: resolved.lambdaMemoryMb,
    reservedConcurrency: outputs.reservedConcurrency,
    deployedAt: new Date().toISOString(),
  });

  if (resolved.reservedConcurrency === -1) {
    console.log(
      c.warn(
        "Removed the stack's reserved concurrency; each render now sizes itself to the account.",
      ),
    );
  } else if (
    resolved.reservedConcurrency === undefined &&
    outputs.reservedConcurrency !== undefined
  ) {
    console.log(
      c.warn(
        `Kept the stack's reserved concurrency of ${outputs.reservedConcurrency}. Pass --concurrency=N to change it.`,
      ),
    );
  }

  console.log();
  console.log(c.success("Stack deployed."));
  console.log(`  ${c.dim("Bucket:")}         ${outputs.bucketName}`);
  console.log(`  ${c.dim("State machine:")}  ${outputs.stateMachineArn}`);
  console.log(`  ${c.dim("Function:")}       ${outputs.functionName}`);
  console.log(`  ${c.dim("State file:")}     ${resolve(statePath)}`);
  console.log();
  console.log(c.dim(`Render with: hyperframes lambda render <project-dir>`));
}

/** Checkout: build the ZIP from source. Otherwise: stage the adapter's pinned prebuilt ZIP. */
async function prepareSamDir(root: string | undefined, args: DeployArgs): Promise<string> {
  if (!root) {
    if (args.chromeSource !== "sparticuz") {
      throw new Error(
        "[lambda deploy] The prebuilt handler bundles sparticuz Chrome; --chrome-source=chrome-headless-shell needs a hyperframes checkout.",
      );
    }
    return stagePrebuiltHandler();
  }
  const samDir = dirname(locateSamTemplate(root));
  if (!args.skipBuild) {
    console.log(c.dim("→ Building handler ZIP"));
    buildHandlerZip(root);
  } else {
    const zip = join(root, "packages", "aws-lambda", "dist", "handler.zip");
    if (!existsSync(zip)) {
      throw new Error(
        `--skip-build set but ${zip} does not exist. Run \`bun run --cwd packages/aws-lambda build:zip\` first or drop --skip-build.`,
      );
    }
  }
  return samDir;
}

function buildHandlerZip(root: string): void {
  // bun run --cwd packages/aws-lambda build:zip
  const result = spawnSync(
    "bun",
    ["run", "--cwd", join(root, "packages", "aws-lambda"), "build:zip"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `[lambda deploy] handler ZIP build exited with code ${result.status ?? "unknown"}`,
    );
  }
}
