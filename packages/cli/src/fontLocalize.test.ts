import { describe, expect, it, vi } from "vitest";
import { runFontLocalize, stampFontVersions, type FontLocalizeIo } from "./fontLocalize.js";

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

describe("stampFontVersions", () => {
  it("records producer and localizer versions inside the document head", () => {
    const stamped = stampFontVersions(
      "<!doctype html><html><head><title>x</title></head><body></body></html>",
      { producer: "0.8.15", localizer: "0.8.16" },
    );

    expect(stamped).toContain('<meta name="hyperframes-font-compiler-version" content="0.8.15">');
    expect(stamped).toContain('<meta name="hyperframes-font-localizer-version" content="0.8.16">');
    expect(stamped.indexOf("hyperframes-font-compiler-version")).toBeLessThan(
      stamped.indexOf("</head>"),
    );
  });

  it("inserts both diagnostic stamps after a doctype when no head close exists", () => {
    const stamped = stampFontVersions("<!doctype html><main>x</main>", {
      producer: "0.8.15",
      localizer: "0.8.16",
    });

    expect(stamped).toMatch(
      /^<!doctype html><meta name="hyperframes-font-compiler-version" content="0\.8\.15"><meta name="hyperframes-font-localizer-version" content="0\.8\.16">/,
    );
  });

  it("inserts both diagnostic stamps at the start when no head or doctype exists", () => {
    const stamped = stampFontVersions("<main>x</main>", {
      producer: "0.8.15<script>",
      localizer: "0.8.16<script>",
    });

    expect(stamped).toBe(
      '<meta name="hyperframes-font-compiler-version" content="0.8.15script"><meta name="hyperframes-font-localizer-version" content="0.8.16script"><main>x</main>',
    );
  });
});
