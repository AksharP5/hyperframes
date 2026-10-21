import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chromeMajor,
  findCaptureDefect,
  scanBackfaceDefect,
  type DefectEnv,
} from "./htmlInCanvasDefects";

const ua = (major: number | null, headless = false) => ({
  navigator: {
    userAgent:
      major === null
        ? "Mozilla/5.0 HappyDOM"
        : `Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ${headless ? "HeadlessChrome" : "Chrome"}/${major}.0.0.0 Safari/537.36`,
  },
});

function mount(html: string, rootStyle = ""): HTMLElement {
  document.body.innerHTML = `<div id="root" style="${rootStyle}">${html}</div>`;
  const root = document.getElementById("root");
  if (!root) throw new Error("no root");
  return root;
}

const env = (over: Partial<DefectEnv> = {}): DefectEnv => ({
  isAccelerated: () => false,
  backface: false,
  ...over,
});

const code = (root: HTMLElement, e: DefectEnv) => findCaptureDefect(root, e)?.code ?? null;

afterEach(() => {
  document.body.innerHTML = document.head.innerHTML = "";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "getAnimations");
});

const animating = (target: Element, frames: object[]) => {
  class Effect {
    target = target;
    getKeyframes = () => frames;
  }
  vi.stubGlobal("KeyframeEffect", Effect);
  Object.assign(document, { getAnimations: () => [{ effect: new Effect() }] });
};

describe("chromeMajor", () => {
  it("reads Chrome and HeadlessChrome, and is null for anything else", () => {
    expect(chromeMajor(ua(152, true))).toBe(152);
    expect(chromeMajor(ua(157))).toBe(157);
    expect(chromeMajor(ua(null))).toBeNull();
  });
});

describe("nested-capture-canvas", () => {
  it("is found on every version, in either API form", () => {
    for (const attr of ["layoutsubtree", 'content="drawable"']) {
      const root = mount(`<canvas ${attr}></canvas>`);
      for (const major of [152, 158, null]) {
        expect(code(root, env({ win: ua(major) }))).toBe("nested-capture-canvas");
      }
    }
  });
});

describe("accelerated-canvas", () => {
  const gl = (root: HTMLElement) => env({ isAccelerated: (c) => root.contains(c) });

  it("applies below 157 and when the version is unknown, not from 157", () => {
    const root = mount("<canvas></canvas>");
    for (const major of [152, 155, null]) {
      expect(code(root, { ...gl(root), win: ua(major) })).toBe("accelerated-canvas");
    }
    for (const major of [157, 158]) expect(code(root, { ...gl(root), win: ua(major) })).toBeNull();
  });

  it("ignores a canvas the page did not give a WebGL context", () => {
    expect(code(mount("<canvas></canvas>"), env({ win: ua(152) }))).toBeNull();
  });
});

describe("iframe-in-root", () => {
  it("applies on every version: a reload cannot be undone", () => {
    const root = mount('<div><iframe src="about:blank"></iframe></div>');
    for (const major of [152, 157, 158])
      expect(code(root, env({ win: ua(major) }))).toBe("iframe-in-root");
  });

  it("is not reported for a composition without an iframe", () => {
    expect(code(mount("<div><img></div>"), env())).toBeNull();
  });
});

describe("root-transform", () => {
  it("applies below 157 and when the version is unknown, not from 157", () => {
    const root = mount("", "transform: scale(0.5)");
    expect(code(root, env({ win: ua(152) }))).toBe("root-transform");
    expect(code(root, env({ win: ua(156) }))).toBe("root-transform");
    expect(code(root, env({ win: ua(null) }))).toBe("root-transform");
    expect(code(root, env({ win: ua(157) }))).toBeNull();
    expect(code(root, env({ win: ua(158) }))).toBeNull();
  });

  it("ignores a root without a transform", () => {
    expect(code(mount(""), env({ win: ua(152) }))).toBeNull();
  });
});

describe("root-opacity", () => {
  it("applies from 155 and when the version is unknown, not on 152", () => {
    const root = mount("", "opacity: 0.5");
    expect(code(root, env({ win: ua(152) }))).toBeNull();
    expect(code(root, env({ win: ua(155) }))).toBe("root-opacity");
    expect(code(root, env({ win: ua(158) }))).toBe("root-opacity");
    expect(code(root, env({ win: ua(null) }))).toBe("root-opacity");
  });

  it("ignores a fully opaque root", () => {
    expect(code(mount("", "opacity: 1"), env({ win: ua(158) }))).toBeNull();
  });
});

describe("backface-visibility", () => {
  const face = "backface-visibility: hidden";

  it("is found on every version once the scan saw one", () => {
    const root = mount("");
    for (const major of [152, 155, 157, 158, null]) {
      expect(code(root, env({ backface: true, win: ua(major) }))).toBe("backface-visibility");
    }
  });

  it("scan: a face inside a preserve-3d card", () => {
    const root = mount(
      `<div style="transform-style: preserve-3d"><div style="${face}"></div></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face under a perspective ancestor", () => {
    const root = mount(`<div style="perspective: 800px"><div style="${face}"></div></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face with its own 3D rotation", () => {
    const root = mount(`<div style="${face}; transform: rotateY(180deg)"></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the -webkit- spelling counts", () => {
    const root = mount(
      '<div style="transform-style: preserve-3d"><div style="-webkit-backface-visibility: hidden"></div></div>',
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face found through a stylesheet rule, including inside @media", () => {
    document.head.innerHTML =
      "<style>.card{transform-style:preserve-3d}@media screen{.face{backface-visibility:hidden}}</style>";
    const root = mount('<div class="card"><div class="face"></div></div>');
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the flat performance hack is not a defect", () => {
    document.head.innerHTML = "<style>.perf{backface-visibility:hidden}</style>";
    const root = mount(
      `<div class="perf"></div><div style="${face}; transform: translate3d(0,0,0)"></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a 3D card without a hidden face is fine", () => {
    const root = mount('<div style="transform-style: preserve-3d"><div></div></div>');
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a selector that cannot be queried is skipped", () => {
    document.head.innerHTML = "<style>.x::before{backface-visibility:hidden}</style>";
    expect(scanBackfaceDefect(mount("<div class='x'></div>"))).toBe(false);
  });

  it("scan: a 3D context outside the root does not count", () => {
    document.body.innerHTML = `<div style="transform-style: preserve-3d"><div id="root"><div style="${face}"></div></div></div>`;
    const root = document.getElementById("root");
    if (!root) throw new Error("no root");
    expect(scanBackfaceDefect(root)).toBe(false);
  });
});

describe("backface-visibility rules the page reaches indirectly", () => {
  const withProps = (proto: object, props: Record<string, unknown>) =>
    Object.create(
      proto,
      Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value }])),
    );
  const rule = (selectorText: string, hidden: boolean, cssRules: unknown[] = []) =>
    withProps(CSSStyleRule.prototype, {
      selectorText,
      cssRules,
      style: {
        getPropertyValue: (n: string) => (hidden && n === "backface-visibility" ? "hidden" : ""),
      },
    });
  const imported = (styleSheet: unknown) => withProps(CSSImportRule.prototype, { styleSheet });
  const sheetOf = (...cssRules: unknown[]) => ({ cssRules });
  const realComputed = window.getComputedStyle.bind(window);
  // jsdom computes no style from the stubbed sheets, so `.face` always computes hidden: what is
  // left to prove is that the scan picks the element as a candidate through the sheet.
  const useSheets = (...sheets: unknown[]) => {
    vi.spyOn(document, "styleSheets", "get").mockReturnValue(sheets as never);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      const cs = realComputed(el);
      if (!el.classList.contains("face")) return cs;
      return new Proxy(cs, {
        get: (target, key) =>
          key === "getPropertyValue"
            ? (n: string) => (n === "backface-visibility" ? "hidden" : target.getPropertyValue(n))
            : Reflect.get(target, key),
      });
    });
  };
  const card = (inner = '<div class="face"></div>') =>
    mount(`<div class="card" style="transform-style: preserve-3d">${inner}</div>`);

  afterEach(() => vi.restoreAllMocks());

  it("finds a face hidden by a nested rule, with or without &", () => {
    for (const nested of ["& .face", ".face", "&>.face"]) {
      useSheets(sheetOf(rule(".card", false, [rule(nested, true)])));
      expect(scanBackfaceDefect(card())).toBe(true);
    }
  });

  it("resolves a nested rule against its parent: a face elsewhere is not found", () => {
    for (const nested of ["& .face", ".face"]) {
      useSheets(sheetOf(rule(".other", false, [rule(nested, true)])));
      expect(scanBackfaceDefect(card())).toBe(false);
    }
  });

  it("walks nested rules several levels down, and each selector of a nested list", () => {
    useSheets(
      sheetOf(rule(".card", false, [rule(".a, .b", false, [rule("& .face, & .x", true)])])),
    );
    expect(scanBackfaceDefect(card('<div class="a"><div class="face"></div></div>'))).toBe(true);
  });

  it("finds a face hidden by an @imported sheet", () => {
    useSheets(sheetOf(imported(sheetOf(rule(".face", true)))));
    expect(scanBackfaceDefect(card())).toBe(true);
  });

  it("skips an @import that is not loaded or that the page may not read", () => {
    const blocked = {
      get cssRules(): never {
        throw new DOMException("cross-origin", "SecurityError");
      },
    };
    useSheets(sheetOf(imported(null), imported(blocked), rule(".face", true)));
    expect(scanBackfaceDefect(card())).toBe(true);
  });

  it("reads a sheet that imports itself once", () => {
    let reads = 0;
    const loop = {
      get cssRules(): unknown[] {
        reads++;
        return [imported(loop), rule(".face", true)];
      },
    };
    useSheets(loop);
    expect(scanBackfaceDefect(card())).toBe(true);
    expect(reads).toBe(1);
  });

  it("stops following @import chains past a fixed depth", () => {
    let chain = sheetOf(rule(".face", true));
    for (let i = 0; i < 40; i++) chain = sheetOf(imported(chain));
    useSheets(chain);
    expect(scanBackfaceDefect(card())).toBe(false);
  });

  it("finds a face whose backface-visibility comes from @keyframes, named or not yet running", () => {
    document.head.innerHTML = "<style>@keyframes flip{to{backface-visibility:hidden}}</style>";
    useSheets(...Array.from(document.styleSheets));
    const face = (name: string) => card(`<div class="face" style="animation-name: ${name}"></div>`);
    expect(scanBackfaceDefect(face("flip"))).toBe(true);
    expect(scanBackfaceDefect(face("other, flip"))).toBe(true);
    expect(scanBackfaceDefect(face("other"))).toBe(false);
  });

  it("finds a face a running animation keys to hidden, inside the root only", () => {
    const root = card();
    const face = root.querySelector(".face") ?? root;
    const outside = document.body.appendChild(document.createElement("div"));
    outside.className = "face";
    outside.style.transformStyle = "preserve-3d";
    useSheets();
    for (const [frames, el, expected] of [
      [{ backfaceVisibility: "hidden" }, face, true],
      [{ backfaceVisibility: "visible" }, face, false],
      [{ backfaceVisibility: "hidden" }, outside, false],
    ] as const) {
      animating(el, [frames]);
      expect(scanBackfaceDefect(root)).toBe(expected);
    }
  });

  it("still leaves the flat backface hack alone when written as a nested rule", () => {
    useSheets(sheetOf(rule(".card", false, [rule("& .face", true)])));
    expect(scanBackfaceDefect(mount('<div class="card"><div class="face"></div></div>'))).toBe(
      false,
    );
  });
});

describe("order", () => {
  it("reports the first applicable defect", () => {
    const root = mount("<canvas layoutsubtree></canvas>", "opacity: 0.5");
    expect(code(root, env({ win: ua(158), backface: true }))).toBe("nested-capture-canvas");
  });
});
