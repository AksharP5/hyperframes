// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPlainKey } from "./useAppHotkeys";
import { usePlayerStore } from "../player/store/playerStore";
import type { TimelineElement } from "../player/store/timelineElement";

/** Minimal valid fixture — TimelineElement only requires these five fields. */
const bgmElement: TimelineElement = {
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 6,
  track: 0,
};

/** Every callback dispatchPlainKey can reach, so a test can assert which one
 *  a key resolved to. Unannotated on purpose: the parameter type is not
 *  exported, and structural inference checks it at the call site. */
function callbacks() {
  return {
    handleTimelineElementDelete: vi.fn(async () => {}),
    handleTimelineElementSplit: vi.fn(async () => {}),
    handleDomEditElementDelete: vi.fn(async () => {}),
    handleUndo: vi.fn(async () => {}),
    handleRedo: vi.fn(async () => {}),
    handleCopy: vi.fn(() => false),
    handlePaste: vi.fn(async () => {}),
    handleCut: vi.fn(async () => false),
    onResetKeyframes: vi.fn(() => true),
    onDeleteSelectedKeyframes: vi.fn(),
    showToast: vi.fn(),
    leftSidebarRef: { current: null },
    domEditSelectionRef: { current: null },
  };
}

const press = (key: string) =>
  new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });

afterEach(() => {
  usePlayerStore.getState().clearAutomationSelection();
  usePlayerStore.setState({
    elements: [],
    selectedElementId: null,
    selectedElementIds: new Set<string>(),
    selectedKeyframes: new Set<string>(),
  });
});

describe("dispatchPlainKey — Delete arbitration", () => {
  const selectBgm = () =>
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });

  const selectRange = () =>
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });

  it("deletes the selected clip when no automation range is active", () => {
    selectBgm();
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    // The pre-existing contract, pinned so the new guard cannot widen.
    expect(cb.handleTimelineElementDelete).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves the clip alone when an automation range is active", () => {
    // The bug: this listener is on window/capture so it runs BEFORE
    // useAutomationSelectionKeyboard's document/capture handler. Without the
    // guard, clearing a 2s automation range deleted the whole audio clip.
    selectBgm();
    selectRange();
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    expect(cb.handleTimelineElementDelete).not.toHaveBeenCalled();
    // Must NOT be consumed: the automation handler downstream still needs it.
    expect(e.defaultPrevented).toBe(false);
  });

  it("leaves keyframe reset alone when an automation range is active", () => {
    // Backspace's reset-keyframes branch sits below the guard, so it has to be
    // covered too — otherwise Backspace wiped every keyframe on the clip.
    selectBgm();
    usePlayerStore.setState({
      keyframeCache: new Map([["bgm", { targets: [], version: 0 }]]),
    });
    selectRange();
    const cb = callbacks();
    const e = press("Backspace");
    dispatchPlainKey(e, "backspace", cb);
    expect(cb.onResetKeyframes).not.toHaveBeenCalled();
    expect(cb.handleTimelineElementDelete).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("still lets a keyframe selection win over an automation range", () => {
    // Ordering: the keyframe guard precedes the automation one, so a keyframe
    // selection keeps Delete even with a range showing.
    selectBgm();
    selectRange();
    usePlayerStore.setState({ selectedKeyframes: new Set(["bgm:opacity:0"]) });
    const cb = callbacks();
    const e = press("Delete");
    dispatchPlainKey(e, "delete", cb);
    expect(cb.onDeleteSelectedKeyframes).toHaveBeenCalledTimes(1);
    expect(cb.handleTimelineElementDelete).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});
