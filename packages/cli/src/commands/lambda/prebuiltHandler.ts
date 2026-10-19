// `lambda deploy` without a repo checkout: fetch the pinned handler ZIP, verify its sha256 and
// stage it beside the packaged SAM template.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../../utils/download.js";
import { isMissingPackageError } from "../../utils/missingPackage.js";
import { VERSION } from "../../version.js";

const DOCS_URL = "https://hyperframes.heygen.com/deploy/aws-lambda";
const HANDLER_CACHE_DIR = join(homedir(), ".cache", "hyperframes", "lambda-handler");

type AdapterSdk = typeof import("@hyperframes/aws-lambda/sdk");

export interface StageDeps {
  loadAdapter: () => Promise<Partial<AdapterSdk>>;
  download: (url: string, dest: string, options: { maxBytes: number }) => Promise<void>;
  cacheDir: string;
  log: (line: string) => void;
}

const defaultDeps: StageDeps = {
  loadAdapter: () => import("@hyperframes/aws-lambda/sdk"),
  download: downloadFile,
  cacheDir: HANDLER_CACHE_DIR,
  log: (line) => console.log(line),
};

/** The one message for "no checkout and no pinned handler": everything the user needs to fix it. */
export function noHandlerMessage(adapterInstalled: boolean): string {
  const adapter = adapterInstalled
    ? "  - The installed @hyperframes/aws-lambda has no prebuilt handler for its version. Install one that does:\n"
    : "  - Install the Lambda adapter; its release pins the prebuilt handler:\n";
  return (
    "[lambda deploy] This is not a HyperFrames checkout, and no prebuilt Lambda handler is available.\n" +
    adapter +
    `      npm install -g @hyperframes/aws-lambda@${VERSION}\n` +
    "  - Or run from a hyperframes checkout, or set HYPERFRAMES_REPO_ROOT to one.\n" +
    `Docs: ${DOCS_URL}`
  );
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Returns the directory holding the verified `handler.zip` and its `template.yaml`. */
export async function stagePrebuiltHandler(deps: StageDeps = defaultDeps): Promise<string> {
  let sdk: Partial<AdapterSdk>;
  try {
    sdk = await deps.loadAdapter();
  } catch (err) {
    if (isMissingPackageError(err, "@hyperframes/aws-lambda"))
      throw new Error(noHandlerMessage(false));
    throw err;
  }
  // Adapters released before handler zips were published lack prebuiltHandler.
  const pinned = sdk.prebuiltHandler?.();
  if (!pinned) throw new Error(noHandlerMessage(true));

  const dir = join(deps.cacheDir, `${pinned.version}-${pinned.sha256}`);
  const zip = join(dir, "handler.zip");
  if (existsSync(zip) && sha256File(zip) === pinned.sha256) {
    deps.log(`→ Using verified handler ZIP ${pinned.version} from ${dir}`);
  } else {
    // Override for mirrors and pre-release testing; the pinned sha256 still decides.
    const url = process.env.HYPERFRAMES_LAMBDA_HANDLER_URL ?? pinned.url;
    deps.log(`→ Downloading handler ZIP ${pinned.version} (${pinned.bytes} bytes)`);
    mkdirSync(dir, { recursive: true });
    const partial = `${zip}.download`;
    await deps.download(url, partial, { maxBytes: pinned.bytes });
    const actual = sha256File(partial);
    if (actual !== pinned.sha256) {
      unlinkSync(partial);
      const urlWithoutCredentials = url.split("?")[0];
      throw new Error(
        `[lambda deploy] Refusing the handler ZIP from ${urlWithoutCredentials}: sha256 ${actual} does not match ` +
          `the ${pinned.sha256} pinned by @hyperframes/aws-lambda@${pinned.version}.`,
      );
    }
    renameSync(partial, zip);
    deps.log(`→ Verified sha256 ${pinned.sha256}`);
  }
  copyFileSync(pinned.templatePath, join(dir, "template.yaml"));
  return dir;
}
