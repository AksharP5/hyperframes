// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { createTimelineRowGeometry } from "./timelineLayout";
import { useTimelineRevealClip } from "./useTimelineRevealClip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const element: TimelineElement = {
  id: "hero",
  tag: "div",
  start: 20,
  duration: 2,
  track: 1,
};
const geometry = createTimelineRowGeometry([1], [48]);

function createHarnessRoot() {
  const host = document.createElement("div");
  document.body.append(host);
  return { host, root: createRoot(host) };
}

interface HarnessProps {
  mounted: boolean;
  version: number;
  width?: number;
  height?: number;
  deferFocusUntilViewportUpdate?: boolean;
  focusedElementId?: string;
}

function Harness({
  mounted,
  version,
  width = 300,
  height = 100,
  deferFocusUntilViewportUpdate = false,
  focusedElementId,
}: HarnessProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useTimelineRevealClip({
    scrollRef,
    elements: [element],
    rowGeometry: geometry,
    pixelsPerSecond: 100,
    contentOrigin: 32,
    allowHorizontal: true,
    deferFocusUntilViewportUpdate,
    focusedElementId,
    viewportVersion: version,
    sessionEpoch: 1,
  });
  return (
    <div
      ref={(node) => {
        scrollRef.current = node;
        if (node) {
          Object.defineProperty(node, "clientWidth", { configurable: true, value: width });
          Object.defineProperty(node, "clientHeight", { configurable: true, value: height });
        }
      }}
    >
      {mounted && <div data-el-id="hero" tabIndex={-1} />}
    </div>
  );
}

async function renderHarness(root: Root, props: HarnessProps): Promise<void> {
  await act(async () => root.render(<Harness {...props} />));
}

afterEach(() => {
  usePlayerStore.getState().reset();
  document.body.replaceChildren();
});

describe("useTimelineRevealClip", () => {
  it("scrolls from model coordinates, then consumes only after the clip mounts", async () => {
    const { host, root } = createHarnessRoot();
    usePlayerStore.getState().requestClipReveal("hero");

    await renderHarness(root, { mounted: false, version: 0 });
    const scroll = host.firstElementChild as HTMLDivElement;
    expect(scroll.scrollLeft).toBe(1_944);
    expect(usePlayerStore.getState().clipRevealRequest?.elementId).toBe("hero");

    await renderHarness(root, { mounted: true, version: 1 });
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    expect(document.activeElement?.getAttribute("data-el-id")).toBe("hero");

    scroll.scrollLeft = 0;
    await act(async () => usePlayerStore.getState().requestClipReveal("hero"));
    await renderHarness(root, { mounted: true, version: 2 });
    expect(scroll.scrollLeft).toBe(1_944);
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    await act(async () => root.unmount());
  });

  it("consumes an invalid target without scrolling", async () => {
    const { root } = createHarnessRoot();
    usePlayerStore.getState().requestClipReveal("missing");
    await renderHarness(root, { mounted: false, version: 0 });
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps a reveal pending through zero-size viewport and virtualized focus handoff", async () => {
    const { host, root } = createHarnessRoot();
    usePlayerStore.getState().requestClipReveal("hero");

    await renderHarness(root, { mounted: true, version: 0, width: 0, height: 0 });
    const scroll = host.firstElementChild as HTMLDivElement;
    expect(scroll.scrollLeft).toBe(0);
    expect(usePlayerStore.getState().clipRevealRequest?.elementId).toBe("hero");
    expect(document.activeElement?.getAttribute("data-el-id")).not.toBe("hero");

    await renderHarness(root, {
      mounted: true,
      version: 1,
      deferFocusUntilViewportUpdate: true,
    });
    expect(scroll.scrollLeft).toBe(1_944);
    expect(usePlayerStore.getState().clipRevealRequest?.elementId).toBe("hero");
    await renderHarness(root, {
      mounted: true,
      version: 2,
      deferFocusUntilViewportUpdate: true,
      focusedElementId: "hero",
    });
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    expect(document.activeElement?.getAttribute("data-el-id")).toBe("hero");
    await act(async () => root.unmount());
  });
});
