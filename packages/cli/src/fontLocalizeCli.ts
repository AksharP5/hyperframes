import { injectDeterministicFontFaces } from "@hyperframes/producer";
import { runFontLocalize } from "./fontLocalize.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

process.exitCode = await runFontLocalize(
  {
    readInput: readStdin,
    writeOutput: (value) => process.stdout.write(value),
    writeError: (value) => process.stderr.write(value),
  },
  (html) =>
    injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
    }),
);
