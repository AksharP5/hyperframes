export interface FontLocalizeIo {
  readInput(): Promise<string>;
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export interface FontVersions {
  producer: string;
  localizer: string;
}

function safeVersion(version: string): string {
  return version.replace(/[^A-Za-z0-9.+-]/g, "") || "unknown";
}

/**
 * Add post-hoc diagnostics for the producer resolver and the CLI wrapper that ran it.
 * These stamps are traceability metadata, not an enforcement mechanism.
 */
export function stampFontVersions(html: string, versions: FontVersions): string {
  const tags =
    `<meta name="hyperframes-font-compiler-version" content="${safeVersion(versions.producer)}">` +
    `<meta name="hyperframes-font-localizer-version" content="${safeVersion(versions.localizer)}">`;
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose >= 0) return `${html.slice(0, headClose)}${tags}${html.slice(headClose)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (!doctype) return `${tags}${html}`;
  const insertAt = doctype.index + doctype[0].length;
  return `${html.slice(0, insertAt)}${tags}${html.slice(insertAt)}`;
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : "Error";
}

/**
 * Machine-only stdin/stdout boundary for deterministic font localization.
 * Source HTML and resolver messages can contain signed URLs, so failures emit
 * only a fixed category plus a sanitized error class.
 */
export async function runFontLocalize(
  io: FontLocalizeIo,
  localize: (html: string) => Promise<string>,
): Promise<number> {
  const html = await io.readInput();
  if (!html.trim()) {
    io.writeError("font localization input is empty\n");
    return 2;
  }

  try {
    const localized = await localize(html);
    if (!localized.trim()) {
      io.writeError("font localization failed (Error): empty output\n");
      return 1;
    }
    io.writeOutput(localized);
    return 0;
  } catch (error) {
    io.writeError(`font localization failed (${safeErrorName(error)})\n`);
    return 1;
  }
}
