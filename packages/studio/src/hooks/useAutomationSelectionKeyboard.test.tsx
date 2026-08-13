// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { usePlayerStore } from "../player/store/playerStore";
import { useAutomationSelectionKeyboard } from "./useAutomationSelectionKeyboard";
import {
  clearAutomationClipboard,
  copyRange,
  readClipboard,
} from "../player/components/automationClipboard";
import { VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type {
  AutomationLaneBinding,
  UseAutomationLanesResult,
} from "../player/components/useAutomationLanes";
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Host({ lanes }: { lanes: UseAutomationLanesResult }) {
  useAutomationSelectionKeyboard({ lanes });
  return null;
}

const key = (k: string) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => void document.dispatchEvent(e));
};

/** Cmd/Ctrl-modified key combo, returning the event so tests can inspect
 *  `defaultPrevented` for the "falls through" cases. */
const combo = (k: string) => {
  const e = new KeyboardEvent("keydown", {
    key: k,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => void document.dispatchEvent(e));
  return e;
};

describe("useAutomationSelectionKeyboard", () => {
  // Each setup() mounts a Host whose effect adds a document-level keydown
  // listener. Without unmounting the previous one, listeners from earlier
  // tests linger and can consume later tests' events first (stopping
  // propagation before the current test's own listener ever runs) — so this
  // must run before every test, not just the ones that call setup() twice.
  let mountedRoot: { root: Root; host: HTMLElement } | null = null;
  afterEach(() => {
    if (!mountedRoot) return;
    act(() => mountedRoot?.root.unmount());
    mountedRoot.host.remove();
    mountedRoot = null;
  });

  const setup = (binding: Partial<AutomationLaneBinding>) => {
    const onCommit = vi.fn();
    const automation = {
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 1 },
            { t: 2, v: 0.5 },
            { t: 4, v: 0 },
          ],
        },
      ],
    };
    const lanes: UseAutomationLanesResult = {
      bind: () => ({
        automation,
        // Same list as `automation.lanes`, matching useAutomationLanes' real
        // binding — the paste fallback (no active selection) reads this.
        lanes: automation.lanes,
        chain: null,
        onPreview: vi.fn(),
        onCommit,
        onSelect: vi.fn(),
        readOnly: false,
        commitTargetKey: "bgm",
        selection: null,
        onRangeSelect: vi.fn(),
        onRangeClear: vi.fn(),
        ...binding,
      }),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Host lanes={lanes} />));
    mountedRoot = { root, host };
    return { onCommit };
  };

  it("Delete empties the selected range and pins anchors", () => {
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    const { onCommit } = setup({});
    key("Delete");
    const written = onCommit.mock.calls.at(-1)?.[0];
    const points = written?.lanes?.[0]?.points ?? [];
    expect(points.map((p: { t: number }) => p.t)).toEqual([0, 1, 3, 4]);
  });

  it("Escape clears the selection", () => {
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    setup({});
    key("Escape");
    expect(usePlayerStore.getState().automationSelection).toBeNull();
  });

  it("is inert while a text input has focus", () => {
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 3 });
    const { onCommit } = setup({});
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    key("Delete");
    expect(onCommit).not.toHaveBeenCalled();
    input.remove();
  });

  it("Cmd+C copies the active selection", () => {
    clearAutomationClipboard();
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    setup({});
    combo("c");
    const entry = readClipboard(null);
    expect(entry?.span).toBe(2);
    expect(entry?.points.map((p) => p.t)).toEqual([0, 2]);
  });

  it("Cmd+V with no selection pastes at the playhead and selects the pasted span", () => {
    clearAutomationClipboard();
    // Duration wide enough that the playhead (5s) is not clamped down by the
    // 0..duration-span bound — this is a paste-at-playhead test, not a
    // clamp-boundary test.
    usePlayerStore.setState({
      elements: [{ ...bgmElement, duration: 10 }],
      selectedElementId: "bgm",
      currentTime: 5,
    });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    const { onCommit } = setup({});
    combo("c");
    expect(readClipboard(null)?.span).toBe(2);
    usePlayerStore.getState().clearAutomationSelection();

    combo("v");
    const written = onCommit.mock.calls.at(-1)?.[0];
    const times = (written?.lanes?.[0]?.points ?? []).map((p: { t: number }) => p.t);
    expect(times).toContain(5); // playhead 5s − element start 0
    expect(times).toContain(7); // + clipboard span 2

    // Pasting again immediately should land right after the first paste.
    expect(usePlayerStore.getState().automationSelection).toEqual({
      elementKey: "bgm",
      target: "volume",
      t0: 5,
      t1: 7,
    });
  });

  it("chains a second Cmd+V after the first instead of overwriting it", () => {
    // The regression this pins: paste leaves its own span selected, so anchoring
    // at sel.t0 unconditionally made every later press recompute the same atT.
    clearAutomationClipboard();
    usePlayerStore.setState({
      elements: [{ ...bgmElement, duration: 10 }],
      selectedElementId: "bgm",
    });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    const { onCommit } = setup({});
    combo("c");

    combo("v");
    const first = (onCommit.mock.calls.at(-1)?.[0]?.lanes?.[0]?.points ?? []).map(
      (p: { t: number }) => p.t,
    );
    expect(first).toContain(2);
    expect(first).toContain(4);

    combo("v");
    const second = (onCommit.mock.calls.at(-1)?.[0]?.lanes?.[0]?.points ?? []).map(
      (p: { t: number }) => p.t,
    );
    expect(second).toContain(4);
    expect(second).toContain(6);
    expect(usePlayerStore.getState().automationSelection).toEqual({
      elementKey: "bgm",
      target: "volume",
      t0: 4,
      t1: 6,
    });
  });

  it("refuses to paste when the dom-edit layer would write to a different clip", () => {
    // selectedElementId says "bgm" but the commit channel is still on the
    // previously selected clip — writing here would serialize bgm's automation
    // onto that other clip and leave bgm untouched.
    clearAutomationClipboard();
    copyRange(null, { target: "volume", points: [{ t: 0, v: 0.5 }] }, VOLUME_RANGE, 0, 2);
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    const { onCommit } = setup({ commitTargetKey: "some-other-clip" });
    const e = combo("v");
    expect(e.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not paste from a playhead outside the clip", () => {
    // No selection on this clip, and the playhead is past its end — there is no
    // anchor. This used to collapse to the clip's own t=0.
    clearAutomationClipboard();
    usePlayerStore.setState({
      elements: [bgmElement],
      selectedElementId: "bgm",
      currentTime: 2,
    });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    const { onCommit } = setup({});
    combo("c");
    usePlayerStore.getState().clearAutomationSelection();
    usePlayerStore.setState({ currentTime: 50 });
    onCommit.mockClear();

    const e = combo("v");
    expect(e.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Cmd+C over an empty lane leaves an earlier clipboard alone", () => {
    // An empty capture is byte-identical to the Delete payload, so arming the
    // clipboard with it turns every later Cmd+V into a destructive flatten.
    clearAutomationClipboard();
    copyRange(null, { target: "volume", points: [{ t: 0, v: 0.5 }] }, VOLUME_RANGE, 0, 3);
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 1, t1: 2 });
    setup({ automation: { version: 1, lanes: [{ target: "volume", points: [] }] } });

    const e = combo("c");
    expect(e.defaultPrevented).toBe(false);
    expect(readClipboard(null)?.span).toBe(3);
  });

  it("pastes with CapsLock on, where e.key is an uppercase V", () => {
    clearAutomationClipboard();
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: "bgm" });
    usePlayerStore
      .getState()
      .setAutomationSelection({ elementKey: "bgm", target: "volume", t0: 2, t1: 4 });
    const { onCommit } = setup({});
    combo("C");
    expect(readClipboard(null)?.span).toBe(2);

    onCommit.mockClear();
    const e = combo("V");
    expect(e.defaultPrevented).toBe(true);
    expect(onCommit).toHaveBeenCalled();
  });

  it("Cmd+V with clipboard content but no resolvable element falls through", () => {
    clearAutomationClipboard();
    copyRange(null, { target: "volume", points: [{ t: 0, v: 1 }] }, VOLUME_RANGE, 0, 1);
    expect(readClipboard(null)).not.toBeNull();
    usePlayerStore.setState({ elements: [bgmElement], selectedElementId: null });
    usePlayerStore.getState().clearAutomationSelection();
    const { onCommit } = setup({});
    const e = combo("v");
    expect(e.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
