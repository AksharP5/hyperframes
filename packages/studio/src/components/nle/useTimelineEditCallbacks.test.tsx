// @vitest-environment happy-dom

import React, { act } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../player";
import type { TimelineEditCallbacks } from "../../player/components/timelineCallbacks";
import { usePlayerStore } from "../../player/store/playerStore";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";

installReactActEnvironment();

const mocks = vi.hoisted(() => ({
  actions: {
    handleGsapRemoveKeyframe: vi.fn(),
    handleGsapMoveKeyframeToPlayhead: vi.fn(),
    handleGsapMoveKeyframe: vi.fn().mockResolvedValue(true),
    handleGsapResizeKeyframedTween: vi.fn().mockResolvedValue(true),
    handleGsapUpdateMeta: vi.fn(),
    handleGsapAddKeyframe: vi.fn(),
    handleGsapAddKeyframeBatch: vi.fn().mockResolvedValue(undefined),
    handleGsapConvertToKeyframes: vi.fn(),
    handleGsapRemoveAllKeyframes: vi.fn(),
    handleGsapDeleteAnimation: vi.fn(),
    buildDomSelectionForTimelineElement: vi.fn(),
  },
  selection: { id: "box", selector: "#box", sourceFile: "index.html" },
  animations: Array<GsapAnimation>(),
}));

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ projectId: "project", activeCompPath: "index.html" }),
}));

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditActionsContext: () => mocks.actions,
  useDomEditSelectionContext: () => ({
    domEditSelection: mocks.selection,
    selectedGsapAnimations: mocks.animations,
  }),
}));

import { useTimelineEditCallbacks } from "./useTimelineEditCallbacks";

const element: TimelineElement = {
  id: "box",
  key: "index.html#box",
  domId: "box",
  tag: "div",
  start: 0,
  duration: 1,
  track: 0,
  sourceFile: "index.html",
};

const flatAnimation: GsapAnimation = {
  id: "box-to-0-position",
  targetSelector: "#box",
  method: "to",
  position: 0,
  resolvedStart: 0,
  duration: 1,
  properties: { x: 420 },
  propertyGroup: "position",
};

const otherFlatAnimation: GsapAnimation = {
  ...flatAnimation,
  id: "circle-to-0-position",
  targetSelector: "#circle",
};

const otherKeyframedAnimation: GsapAnimation = {
  ...otherFlatAnimation,
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 420 } },
    ],
  },
};

function authoredInteriorAnimation(): GsapAnimation {
  return {
    ...flatAnimation,
    keyframes: {
      format: "percentage",
      keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 50, properties: { x: 210 } },
        { percentage: 100, properties: { x: 420 } },
      ],
    },
  };
}

function renderCallbacks(): { callbacks: TimelineEditCallbacks; unmount: () => void } {
  let callbacks: TimelineEditCallbacks | null = null;
  function Harness() {
    callbacks = useTimelineEditCallbacks({
      handleTimelineElementMove: vi.fn(),
      handleTimelineElementsMove: vi.fn(),
      handleTimelineElementResize: vi.fn(),
      handleTimelineGroupResize: vi.fn(),
      handleToggleTrackHidden: vi.fn(),
      handleBlockedTimelineEdit: vi.fn(),
      handleTimelineElementSplit: vi.fn(),
      handleRazorSplit: vi.fn(),
      handleRazorSplitAll: vi.fn(),
    });
    return null;
  }
  const root = mountReactHarness(<Harness />);
  if (!callbacks) throw new Error("timeline callbacks did not initialize");
  return { callbacks, unmount: () => act(() => root.unmount()) };
}

function arrangeClickedCircle(): {
  circle: TimelineElement;
  selection: { id: string; selector: string; sourceFile: string };
} {
  const elementKey = "scenes/main.html#circle";
  const circle: TimelineElement = {
    ...element,
    id: "circle",
    key: elementKey,
    domId: "circle",
    sourceFile: "scenes/main.html",
  };
  const selection = { id: "circle", selector: "#circle", sourceFile: "scenes/main.html" };
  usePlayerStore.setState({
    elements: [element, circle],
    gsapAnimations: new Map([[elementKey, [otherKeyframedAnimation]]]),
  });
  mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(selection);
  return { circle, selection };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.animations = [flatAnimation];
  mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(mocks.selection);
  usePlayerStore.setState({
    currentTime: 0.5,
    elements: [element],
    domClipChildren: [],
    keyframeCache: new Map(),
    gsapAnimations: new Map([["box", [flatAnimation]]]),
  });
});

afterEach(() => {
  usePlayerStore.setState({
    elements: [],
    domClipChildren: [],
    keyframeCache: new Map(),
    gsapAnimations: new Map(),
  });
});

describe("useTimelineEditCallbacks — flat tween keyframe lanes", () => {
  it("adds an interior point through the add-keyframe persist boundary", async () => {
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onTogglePropertyGroupKeyframe?.(element, {
        animationId: flatAnimation.id,
        propertyGroup: "position",
        tweenPercentage: 50,
        properties: { x: 210 },
        remove: false,
      });
    });

    expect(mocks.actions.handleGsapAddKeyframeBatch).toHaveBeenCalledWith(
      flatAnimation.id,
      50,
      { x: 210 },
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapConvertToKeyframes).not.toHaveBeenCalled();
    view.unmount();
  });

  it("retimes a flat tween's boundary through update-meta, not the keyframe writer", async () => {
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.(
        "box",
        {
          percentage: 0,
          propertyGroup: "position",
          tweenPercentage: 0,
          animationId: flatAnimation.id,
        },
        25,
      ),
    ).resolves.toBe(true);

    // The start boundary moved to 0.25s; the end stays put, so the window is 0.75s.
    expect(mocks.actions.handleGsapUpdateMeta).toHaveBeenCalledWith(
      flatAnimation.id,
      { position: 0.25, duration: 0.75 },
      mocks.selection,
    );
    expect(mocks.actions.handleGsapMoveKeyframe).not.toHaveBeenCalled();
    // resize-keyframed-tween would convert the flat tween to keyframes form.
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });

  it("refuses a non-selected element flat boundary instead of deleting the tween", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["scenes/main.html#circle", [otherFlatAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteKeyframe?.("scenes/main.html#circle", {
        percentage: 0,
        propertyGroup: "position",
        tweenPercentage: 0,
        animationId: otherFlatAnimation.id,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Persisted through the CLICKED element's own selection, not the current one,
    // and as a remove-keyframe the writer can refuse — never a whole-tween delete.
    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      otherFlatAnimation.id,
      0,
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("removes a non-selected element authored endpoint through the clicked element's selection", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["index.html#circle", [otherKeyframedAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteKeyframe?.("scenes/main.html#circle", {
        percentage: 100,
        propertyGroup: "position",
        tweenPercentage: 100,
        animationId: otherKeyframedAnimation.id,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      otherKeyframedAnimation.id,
      100,
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("deletes all keyframes through the clicked non-selected element's identity", async () => {
    const { circle, selection } = arrangeClickedCircle();
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteAllKeyframes?.(circle);
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapRemoveAllKeyframes).toHaveBeenCalledWith(
      otherKeyframedAnimation.id,
      selection,
    );
    view.unmount();
  });

  it("moves a keyframe to the playhead through the clicked non-selected element's identity", async () => {
    const { circle, selection } = arrangeClickedCircle();
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onMoveKeyframeToPlayhead?.(circle, {
        percentage: 100,
        propertyGroup: "position",
        tweenPercentage: 100,
        animationId: otherKeyframedAnimation.id,
      });
      await Promise.resolve();
    });

    // The retime target, the selection it commits through, and the animation the
    // playhead percentage is computed against all come from the CLICKED element.
    expect(mocks.actions.handleGsapMoveKeyframeToPlayhead).toHaveBeenCalledWith(
      otherKeyframedAnimation.id,
      100,
      selection,
      otherKeyframedAnimation,
    );
    view.unmount();
  });

  it("keeps a selected-element flat boundary on the remove-keyframe path", () => {
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", {
        percentage: 0,
        propertyGroup: "position",
        tweenPercentage: 0,
        animationId: flatAnimation.id,
      });
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      flatAnimation.id,
      0,
      undefined,
      undefined,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("routes the flat lane-header remove toggle through the refusable remove path", async () => {
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onTogglePropertyGroupKeyframe?.(element, {
        animationId: flatAnimation.id,
        propertyGroup: "position",
        tweenPercentage: 100,
        properties: { x: 420 },
        remove: true,
      });
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      flatAnimation.id,
      100,
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  // The lane-header toggle fires on whichever element owns the lane, which need
  // not be the selected one. It must still commit through that element's own
  // selection, and it must never escalate a flat tween to a whole-tween delete.
  it("removes a non-selected element's flat tween through that element's own selection", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["scenes/main.html#circle", [otherFlatAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onTogglePropertyGroupKeyframe?.(circle, {
        animationId: otherFlatAnimation.id,
        propertyGroup: "position",
        tweenPercentage: 0,
        properties: { x: 0 },
        remove: true,
      });
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      otherFlatAnimation.id,
      0,
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps authored interior deletion on the per-keyframe path", () => {
    mocks.animations = [authoredInteriorAnimation()];
    usePlayerStore.setState({ gsapAnimations: new Map([["box", mocks.animations]]) });
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", {
        percentage: 50,
        propertyGroup: "position",
        tweenPercentage: 50,
        animationId: flatAnimation.id,
      });
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      flatAnimation.id,
      50,
      undefined,
      undefined,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps an authored interior drag on the per-keyframe move path", async () => {
    const authored = authoredInteriorAnimation();
    mocks.animations = [authored];
    usePlayerStore.setState({ gsapAnimations: new Map([["box", [authored]]]) });
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.(
        "box",
        {
          percentage: 50,
          propertyGroup: "position",
          tweenPercentage: 50,
          animationId: authored.id,
        },
        75,
      ),
    ).resolves.toBe(true);

    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(
      authored.id,
      50,
      75,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });

  // A drag starts on whatever diamond the pointer is over, which need not be the
  // selected element. Resolving against the selection would retime the selected
  // element's tween and commit it through the selected element's file.
  it("retimes a non-selected element's keyframe through that element's own selection", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
      sourceFile: "scenes/main.html",
    };
    const circleSelection = { id: "circle", selector: "#circle", sourceFile: "scenes/main.html" };
    const circleAnimation = { ...authoredInteriorAnimation(), id: "circle-to-0-position" };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["scenes/main.html#circle", [circleAnimation]]]),
    });
    mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(circleSelection);
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onMoveKeyframe?.(
        "scenes/main.html#circle",
        {
          percentage: 50,
          propertyGroup: "position",
          tweenPercentage: 50,
          animationId: circleAnimation.id,
        },
        75,
      );
    });

    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(
      circleAnimation.id,
      50,
      75,
      circleSelection,
    );
    view.unmount();
  });

  it("uses the clip timing basis when retiming a duration-less tween", async () => {
    const durationless = {
      ...authoredInteriorAnimation(),
      position: 3.2,
      resolvedStart: 3.2,
      duration: undefined,
    };
    const wideElement = { ...element, start: 10.94, duration: 16.26 };
    mocks.animations = [durationless];
    usePlayerStore.setState({
      elements: [wideElement],
      gsapAnimations: new Map([["box", [durationless]]]),
    });
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.(
        "box",
        {
          percentage: 19.1,
          propertyGroup: "position",
          tweenPercentage: 50,
          animationId: durationless.id,
        },
        40,
      ),
    ).resolves.toBe(true);

    // The whole point of the clip basis: the drop lands at 10.94 + 0.40 * 16.26 =
    // 17.444s, and the duration-less tween borrows the clip's 16.26s window from
    // its 3.2s start, so 17.444 - 3.2 over 16.26 is 87.601%. Any other basis (a
    // zero-length tween, or the clip's own 0-100 %) produces a different number.
    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(
      durationless.id,
      50,
      expect.closeTo(87.601, 3),
      mocks.selection,
    );
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });
});
