import { describe, expect, it } from "bun:test";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

async function requestedGoogleFontUrl(html: string): Promise<URL> {
  let requestedUrl = "";
  const fetchImpl = (async (input: unknown) => {
    requestedUrl = String(input);
    return new Response("", { status: 400 });
  }) as unknown as typeof fetch;

  await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
  });
  return new URL(requestedUrl);
}

describe("Google Fonts text subsetting", () => {
  it("sends the composition character set to the CSS API", async () => {
    const url = await requestedGoogleFontUrl(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>旅行ランキング</h1></body></html>`,
    );

    const text = url.searchParams.get("text") ?? "";
    for (const character of new Set("旅行ランキング")) {
      expect(text).toContain(character);
    }
  });

  it("includes decoded HTML entities from visible composition text", async () => {
    const url = await requestedGoogleFontUrl(
      `<!doctype html><html><head><style>
        h1 { font-family: "Noto Performance Test", sans-serif; }
      </style></head><body><h1>&#x65C5;&#34892;</h1></body></html>`,
    );

    expect(url.searchParams.get("text")).toContain("旅行");
  });

  it("includes case variants for transformed supplemental alias weights", async () => {
    const url = await requestedGoogleFontUrl(
      `<!doctype html><html><head><style>
        h1 { font-family: "Inter", sans-serif; font-weight: 800; text-transform: uppercase; }
      </style></head><body><h1>Your Kidney Transplant:<br/>What Happens Next</h1></body></html>`,
    );

    const text = url.searchParams.get("text") ?? "";
    for (const character of new Set("YOUR KIDNEY TRANSPLANT:WHAT HAPPENS NEXT")) {
      expect(text).toContain(character);
    }
  });

  it("falls back to the full font when case closure exceeds the text URL budget", async () => {
    const caseChangingCharacters = Array.from({ length: 0x500 }, (_, index) =>
      String.fromCodePoint(index),
    )
      .filter((character) => character.toUpperCase() !== character.toLowerCase())
      .slice(0, 300)
      .join("");

    const url = await requestedGoogleFontUrl(
      `<!doctype html><html><head><style>
        p { font-family: "Inter", sans-serif; font-weight: 800; text-transform: uppercase; }
      </style></head><body><p>${caseChangingCharacters}</p></body></html>`,
    );

    expect(url.searchParams.has("text")).toBe(false);
  });
});
