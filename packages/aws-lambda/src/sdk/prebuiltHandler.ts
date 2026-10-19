// The handler ZIP pinned to this package version; the release workflow writes `prebuilt/`.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HANDLER_ZIP_ASSET = "hyperframes-lambda-handler.zip";
export const PREBUILT_DIR = "prebuilt";
export const HANDLER_MANIFEST_FILE = "handler-zip.json";

export interface HandlerZipManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface PrebuiltHandler extends HandlerZipManifest {
  /** SAM template whose `CodeUri` is `handler.zip` in the same directory. */
  templatePath: string;
}

/** This package's root, found by walking up from the running module (source or bundle). */
export function adapterPackageRoot(): string {
  const from = fileURLToPath(import.meta.url);
  for (let dir = dirname(from); dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (
      existsSync(pkg) &&
      JSON.parse(readFileSync(pkg, "utf-8")).name === "@hyperframes/aws-lambda"
    )
      return dir;
  }
  throw new Error(`[aws-lambda] no @hyperframes/aws-lambda package.json above ${from}`);
}

/** The pinned handler for this install, or undefined when this build carries none. */
export function prebuiltHandler(root: string = adapterPackageRoot()): PrebuiltHandler | undefined {
  const dir = join(root, PREBUILT_DIR);
  const manifestPath = join(dir, HANDLER_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as HandlerZipManifest;
  return { ...manifest, templatePath: join(dir, "template.yaml") };
}
