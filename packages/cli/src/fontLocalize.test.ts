import { describe, expect, it, vi } from "vitest";
import { runFontLocalize, type FontLocalizeIo } from "./fontLocalize.js";

function makeIo(input: string): {
  io: FontLocalizeIo;
  output: string[];
  errors: string[];
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      readInput: async () => input,
      writeOutput: (value) => output.push(value),
      writeError: (value) => errors.push(value),
    },
    output,
    errors,
  };
}

describe("runFontLocalize", () => {
  it("writes only the localized document to stdout", async () => {
    const harness = makeIo("<html>source</html>");
    const localize = vi.fn(async () => "<html>localized</html>");

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(0);
    expect(localize).toHaveBeenCalledWith("<html>source</html>");
    expect(harness.output).toEqual(["<html>localized</html>"]);
    expect(harness.errors).toEqual([]);
  });

  it("rejects blank input without calling the resolver", async () => {
    const harness = makeIo("  \n");
    const localize = vi.fn(async (html: string) => html);

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(2);
    expect(localize).not.toHaveBeenCalled();
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("input is empty");
  });

  it("fails without echoing source HTML or resolver details", async () => {
    const source = '<html><img src="https://signed.example/secret"></html>';
    const harness = makeIo(source);
    const localize = vi.fn(async () => {
      throw new Error(`fetch failed for ${source}`);
    });

    const exitCode = await runFontLocalize(harness.io, localize);

    expect(exitCode).toBe(1);
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("font localization failed (Error)");
    expect(harness.errors.join(" ")).not.toContain("signed.example");
    expect(harness.errors.join(" ")).not.toContain("<html>");
  });

  it("fails closed when the resolver returns an empty document", async () => {
    const harness = makeIo("<html>source</html>");

    const exitCode = await runFontLocalize(harness.io, async () => "\n");

    expect(exitCode).toBe(1);
    expect(harness.output).toEqual([]);
    expect(harness.errors.join(" ")).toContain("empty output");
  });
});
