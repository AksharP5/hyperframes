import { describe, expect, it } from "vitest";
import { duplicateElementInHtml } from "./duplicateElement.js";
import { parseSourceDocument } from "./sourceMutation.js";

describe("duplicateElementInHtml", () => {
  it("ripples a following natural-duration video by the resolved source clip length", () => {
    const source = `<div>
      <video id="clip" src="red.mp4" data-start="1" data-track-index="0"></video>
      <video id="next" src="blue.mp4" data-start="3" data-track-index="0"></video>
      <video id="other" src="blue.mp4" data-start="3" data-track-index="1"></video>
    </div>`;

    const result = duplicateElementInHtml(source, { id: "clip" }, "clip-copy", 3, 2);
    const { document } = parseSourceDocument(result.html);

    expect(result.matched).toBe(true);
    expect(document.getElementById("clip")?.getAttribute("data-start")).toBe("1");
    expect(document.getElementById("clip-copy")?.getAttribute("data-start")).toBe("3");
    expect(document.getElementById("next")?.getAttribute("data-start")).toBe("5");
    expect(document.getElementById("other")?.getAttribute("data-start")).toBe("3");
    expect(document.getElementById("clip-copy")?.hasAttribute("data-duration")).toBe(false);
  });

  it.each([undefined, 7])("keeps an authored duration with fallback %s", (fallback) => {
    const source = `<div>
      <div id="clip" data-start="1" data-duration="2" data-track-index="0"></div>
      <div id="next" data-start="3" data-duration="2" data-track-index="0"></div>
    </div>`;

    const result = duplicateElementInHtml(source, { id: "clip" }, "clip-copy", 3, fallback);
    const { document } = parseSourceDocument(result.html);

    expect(result.matched).toBe(true);
    expect(document.getElementById("next")?.getAttribute("data-start")).toBe("5");
    expect(document.getElementById("clip-copy")?.getAttribute("data-duration")).toBe("2");
  });

  it("duplicates a target inside a nested template", () => {
    const source = `<!doctype html><html><body>
      <template data-composition-id="outer"><template data-composition-id="inner">
        <div data-hf-id="hf-deep" data-start="0" data-duration="1" data-track-index="0">clip</div>
      </template></template>
    </body></html>`;

    const result = duplicateElementInHtml(source, { hfId: "hf-deep" }, "clip-copy", 1);

    expect(result.matched).toBe(true);
    expect(result.newId).toBe("clip-copy");
    expect(result.html).toContain('id="clip-copy"');
    expect(result.html).toContain('data-start="1"');
  });

  it("deduplicates a composition id on the clone", () => {
    const source = `<div data-composition-id="main"><div id="scene" data-composition-id="scene" data-start="0" data-duration="1">clip</div></div>`;

    const result = duplicateElementInHtml(source, { id: "scene" }, "scene-copy", 1);

    expect(result.matched).toBe(true);
    expect(result.html).toContain('id="scene-copy" data-composition-id="scene-split"');
    expect(result.html.match(/data-composition-id="scene"/g)).toHaveLength(1);
  });
});
