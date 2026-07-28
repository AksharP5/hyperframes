// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGsapScript } from "@hyperframes/core/gsap-parser";
import { addAnimationWithKeyframesToScript } from "@hyperframes/parsers/gsap-writer-acorn";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { buildStableSelector, getSelectorIndex } from "../components/editor/domEditingDom";
import { resolveSelectorElementIds, writeTargetSelector } from "./gsapShared";
import { commitKeyframeAtTimeImpl } from "./gsapKeyframeCommit";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A selection built the way production builds it (getDomLayerPatchTarget), so
 * the class-only case under test is the real one: buildStableSelector hands back
 * a BARE class for an element with no id / hf-id / composition id.
 */
function selectionFor(el: HTMLElement): DomEditSelection {
  const selector = buildStableSelector(el);
  return {
    element: el,
    id: el.id || undefined,
    hfId: el.getAttribute("data-hf-id") || undefined,
    selector,
    selectorIndex: getSelectorIndex(document, el, selector, "index.html", null),
    sourceFile: "index.html",
    dataAttributes: { start: "0", duration: "2" },
  } as unknown as DomEditSelection;
}

/** Five class-only siblings — the shape that made one add collapse the timeline. */
function mountGroupSiblings(): HTMLElement[] {
  document.body.innerHTML = `
    <div id="scene" class="clip" data-start="0" data-duration="2">
      <div class="group"></div>
      <div class="group"></div>
      <div class="group"></div>
      <div class="group"></div>
      <div class="group"></div>
    </div>
  `;
  return Array.from(document.querySelectorAll<HTMLElement>(".group"));
}

const BASE_SCRIPT = `
const tl = gsap.timeline({ paused: true });
tl.to("#scene", { opacity: 1, duration: 0.5 }, 0);
`.trim();

const KEYFRAMES = [
  { percentage: 0, properties: { x: 0 } },
  { percentage: 100, properties: { x: 40 } },
];

/** Author the selector into a real script and read the tween's targets back. */
function roundTripTargets(selector: string): { script: string; targets: string[] } {
  const { script } = addAnimationWithKeyframesToScript(BASE_SCRIPT, selector, 0, 1, KEYFRAMES);
  const added = parseGsapScript(script).animations.find((a) => a.targetSelector === selector);
  if (!added) throw new Error(`written selector did not re-parse: ${selector}`);
  return { script, targets: resolveSelectorElementIds(added.targetSelector, document) };
}

describe("writeTargetSelector", () => {
  it("addresses exactly one element when the only identity is a shared class", () => {
    const groups = mountGroupSiblings();
    const selection = selectionFor(groups[2]);

    // Precondition: this is the defect's input — a bare class hitting all five.
    expect(selection.selector).toBe(".group");
    expect(document.querySelectorAll(".group")).toHaveLength(5);

    const written = writeTargetSelector(selection);

    expect(written).toBeTruthy();
    expect(document.querySelectorAll(written!)).toHaveLength(1);
    expect(document.querySelector(written!)).toBe(groups[2]);
  });

  it("keeps a unique #id target", () => {
    document.body.innerHTML = `<div id="box" class="card"></div>`;
    const el = document.querySelector<HTMLElement>("#box")!;

    expect(writeTargetSelector(selectionFor(el))).toBe("#box");
  });

  it("prefers data-hf-id over a generated structural selector", () => {
    document.body.innerHTML = `
      <div id="scene"><div class="group"></div><div class="group" data-hf-id="hf-42"></div></div>
    `;
    const el = document.querySelectorAll<HTMLElement>(".group")[1]!;

    const written = writeTargetSelector(selectionFor(el));

    expect(written).toBe('[data-hf-id="hf-42"]');
    expect(document.querySelector(written!)).toBe(el);
  });

  it("keeps an already-unique class selector as authored", () => {
    document.body.innerHTML = `<div id="scene"><div class="header"></div></div>`;
    const el = document.querySelector<HTMLElement>(".header")!;

    expect(writeTargetSelector(selectionFor(el))).toBe(".header");
  });
});

describe("writeTargetSelector — write/read round trip", () => {
  it("re-parses and attributes the new tween to the one element it targeted", () => {
    const groups = mountGroupSiblings();
    // Ids let resolveSelectorElementIds name the attributed elements; the
    // SELECTION still has none, so the write path still faces the bare class.
    groups.forEach((el, i) => el.setAttribute("id", `group-${i}`));
    const selection = { ...selectionFor(groups[2]), id: undefined } as DomEditSelection;

    const written = writeTargetSelector(selection);
    const { targets } = roundTripTargets(written!);

    expect(targets).toEqual(["group-2"]);
  });

  it("does not widen the add to the element's four class siblings", () => {
    const groups = mountGroupSiblings();
    groups.forEach((el, i) => el.setAttribute("id", `group-${i}`));
    const selection = { ...selectionFor(groups[0]), id: undefined } as DomEditSelection;

    // The old bare-class write attributed the one add to every sibling — the
    // attribution blow-up behind "one add collapsed the timeline to a single row".
    expect(roundTripTargets(".group").targets).toHaveLength(5);

    expect(roundTripTargets(writeTargetSelector(selection)!).targets).toHaveLength(1);
  });
});

describe("commitKeyframeAtTimeImpl — new-tween target", () => {
  it("authors a one-element selector when no tween exists at the playhead", async () => {
    const groups = mountGroupSiblings();
    const selection = selectionFor(groups[3]);
    const commitMutation = vi.fn(async () => undefined);

    await commitKeyframeAtTimeImpl(selection, 1, [], { x: 12 }, commitMutation);

    const mutation = commitMutation.mock.calls[0]?.[1] as { targetSelector: string };
    expect(mutation.targetSelector).not.toBe(".group");
    expect(document.querySelectorAll(mutation.targetSelector)).toHaveLength(1);
    expect(document.querySelector(mutation.targetSelector)).toBe(groups[3]);
  });
});
