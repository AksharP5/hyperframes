import { describe, expect, it } from "vitest";
import {
  type MotionBlurProbe,
  dropMotionBlurConsoleEcho,
  motionBlurDrafts,
} from "./checkMotionBlur.js";

const off = (reasonCode: string | null, reason = "because"): MotionBlurProbe => ({
  state: "off",
  reason,
  reasonCode,
  movers: 0,
});

describe("motionBlurDrafts", () => {
  it("says nothing without an opt-in to read, or when blur works", () => {
    expect(motionBlurDrafts(null)).toEqual([]);
    expect(motionBlurDrafts({ state: "on", reason: null, reasonCode: null, movers: 2 })).toEqual(
      [],
    );
    expect(motionBlurDrafts({ state: "on", reason: null, reasonCode: null, movers: 1 })).toEqual(
      [],
    );
  });

  it.each([
    [
      "accelerated-canvas",
      /in sub-compositions too.*render that effect separately.*drop data-motion-blur/,
    ],
    ["backface-visibility", /mirrored.*3D flip/],
    ["iframe-in-root", /<iframe>, <object>, <embed> or custom element out of the composition root/],
    ["root-transform", /child element instead of the composition root/],
    ["root-opacity", /child element instead of the composition root/],
    ["root-blend-mode", /mix-blend-mode on a child element/],
    ["nested-capture-canvas", /inner <canvas layoutsubtree>/],
    ["something-new", /drop data-motion-blur/],
  ])("warns with a concrete fix for %s", (code, hint) => {
    const [finding, ...rest] = motionBlurDrafts(off(code, "the reason text"));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      code: "motion_blur_off",
      severity: "warning",
      message: 'data-motion-blur="on" is set but blur is off: the reason text',
    });
    expect(finding?.fixHint).toMatch(hint);
  });

  it("only informs, once, when the browser cannot run html-in-canvas", () => {
    const drafts = motionBlurDrafts(off("unsupported-browser", "html-in-canvas is unavailable"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ code: "motion_blur_unverified", severity: "info" });
    expect(drafts[0]?.message).toContain("could not be evaluated in this browser");
  });

  it("informs when blur is on but nothing moves", () => {
    expect(
      motionBlurDrafts({ state: "on", reason: null, reasonCode: null, movers: 0 }),
    ).toMatchObject([{ code: "motion_blur_no_movers", severity: "info" }]);
  });
});

describe("dropMotionBlurConsoleEcho", () => {
  const echo = { code: "console_warning", message: "[motion-blur] off: because" };
  const other = { code: "console_warning", message: "something else" };
  const found = motionBlurDrafts(off("root-transform"));

  it("drops the runtime's own off-line once a finding says it", () => {
    expect(dropMotionBlurConsoleEcho([echo, other], found)).toEqual([other]);
  });

  it("leaves every console warning alone when there is no finding", () => {
    expect(dropMotionBlurConsoleEcho([echo, other], [])).toEqual([echo, other]);
  });
});
