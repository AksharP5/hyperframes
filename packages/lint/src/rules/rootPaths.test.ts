import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

const page = (body: string) => `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">${body}</div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;

async function hints(html: string, compSrcPath?: string) {
  const result = await lintHyperframeHtml(
    html,
    compSrcPath ? { compSrcPath, isSubComposition: true } : {},
  );
  return result.findings
    .filter((finding) => finding.code === "root_path_missing_in_preview")
    .map((finding) => finding.fixHint);
}

describe("root paths the preview cannot find", () => {
  it("names each with its relative form: tags, inline and block CSS, fetch and new URL", async () => {
    expect(
      await hints(
        page(`<img src="/assets/logo.png"><div style="background: url('/assets/bg.png')"></div>
          <style>.card { background: url(/assets/card.png); }</style>
          <script>fetch("/data/words.json"); new URL("/assets/clip.mp4", location.href);</script>`),
      ),
    ).toEqual([
      'Use "assets/logo.png" instead.',
      'Use "assets/bg.png" instead.',
      'Use "assets/card.png" instead.',
      'Use "data/words.json" instead.',
      'Use "assets/clip.mp4" instead.',
    ]);
  });

  it("gives a sub-composition the project path too, and a stylesheet file the path from its own folder", async () => {
    expect(await hints(page(`<img src="/assets/logo.png">`), "compositions/intro.html")).toEqual([
      'Use "assets/logo.png" instead.',
    ]);
    const result = await lintHyperframeHtml(page(""), {
      externalStyles: [
        {
          href: "styles/main.css",
          content: ".a { background: url(/assets/bg.png) }",
          rootRelativePath: "styles/main.css",
        },
      ],
    });
    expect(
      result.findings
        .filter((finding) => finding.code === "root_path_missing_in_preview")
        .map((finding) => finding.fixHint),
    ).toEqual(['Use "../assets/bg.png" instead.']);
  });

  it("leaves module imports (the preview maps them), relative paths, other hosts and links alone", async () => {
    expect(
      await hints(
        page(`<img src="assets/logo.png"><img src="//cdn.example/x.png"><a href="/">home</a>
          <script type="module">const scene = await import("/assets/scene.js"); import("/lib/x.js");</script>
          <script>fetch("https://api.example/x"); fetch(\`/\${name}.json\`);</script>`),
      ),
    ).toEqual([]);
  });

  it("warns on an import map the browser would ignore, and not on a valid one", async () => {
    const codes = async (map: string) =>
      (await lintHyperframeHtml(page(`<script type="importmap">${map}</script>`))).findings
        .map((finding) => finding.code)
        .filter((code) => code === "import_map_invalid");
    expect(await codes(`{"imports": {"three": "./vendor/three.js",}}`)).toEqual([
      "import_map_invalid",
    ]);
    expect(await codes(`{"imports": {"three": "./vendor/three.js"}}`)).toEqual([]);
  });
});
