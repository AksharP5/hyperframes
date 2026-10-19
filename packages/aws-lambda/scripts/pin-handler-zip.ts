#!/usr/bin/env bun
// Release step: writes the handler ZIP's pin (asset URL + sha256) and the SAM template into the
// package. A retried release run reuses the ZIP already on the release.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HANDLER_MANIFEST_FILE,
  HANDLER_ZIP_ASSET,
  type HandlerZipManifest,
  PREBUILT_DIR,
} from "../src/sdk/prebuiltHandler.js";

const CHECKOUT_CODE_URI = "CodeUri: ../../packages/aws-lambda/dist/handler.zip";

export function pinHandlerZip(repoRoot: string): HandlerZipManifest {
  const pkgDir = join(repoRoot, "packages", "aws-lambda");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as {
    version: string;
    repository: { url: string };
  };
  const asset = join(repoRoot, "dist", HANDLER_ZIP_ASSET);
  const built = join(pkgDir, "dist", "handler.zip");
  if (existsSync(built)) {
    mkdirSync(dirname(asset), { recursive: true });
    renameSync(built, asset);
    rmSync(`${built}.manifest.json`, { force: true });
  }
  const bytes = readFileSync(asset);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(asset.replace(/\.zip$/, ".sha256"), `${sha256}  ${HANDLER_ZIP_ASSET}\n`);

  const template = readFileSync(join(repoRoot, "examples", "aws-lambda", "template.yaml"), "utf-8");
  if (template.split(CHECKOUT_CODE_URI).length !== 2) {
    throw new Error(
      `[pin-handler-zip] expected exactly one "${CHECKOUT_CODE_URI}" in the template`,
    );
  }
  const outDir = join(pkgDir, PREBUILT_DIR);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "template.yaml"),
    template.replace(CHECKOUT_CODE_URI, "CodeUri: handler.zip"),
  );
  const manifest: HandlerZipManifest = {
    version: pkg.version,
    url: `${pkg.repository.url}/releases/download/v${pkg.version}/${HANDLER_ZIP_ASSET}`,
    sha256,
    bytes: bytes.length,
  };
  writeFileSync(join(outDir, HANDLER_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.main) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  console.log(JSON.stringify(pinHandlerZip(repoRoot), null, 2));
}
