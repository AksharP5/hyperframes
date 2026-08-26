export interface FontLocalizeIo {
  readInput(): Promise<string>;
  writeOutput(value: string): void;
  writeError(value: string): void;
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
