import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHECKOUT_CODE_URI = "CodeUri: ../../packages/aws-lambda/dist/handler.zip";

/** Writes `<outDir>/template.yaml`: the example SAM template, pointed at a `handler.zip` beside it. */
export function writePrebuiltTemplate(repoRoot, outDir) {
  const template = readFileSync(join(repoRoot, "examples", "aws-lambda", "template.yaml"), "utf-8");
  if (template.split(CHECKOUT_CODE_URI).length !== 2) {
    throw new Error(
      `[prebuilt-template] expected exactly one "${CHECKOUT_CODE_URI}" in the template`,
    );
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "template.yaml"),
    template.replace(CHECKOUT_CODE_URI, "CodeUri: handler.zip"),
  );
}
