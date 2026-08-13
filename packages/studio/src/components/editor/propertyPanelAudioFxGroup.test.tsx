// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { AudioFxGroup } from "./propertyPanelAudioFxGroup.js";
import type { DomEditSelection } from "./domEditingTypes";
import { liveTime, usePlayerStore } from "../../player";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHAIN = JSON.stringify({
  version: 1,
  nodes: [{ type: "lowpass", id: "n1", params: { frequency: 900, q: 1.2, poles: "2" } }],
});

// Each mount appends its tracks to the document; without clearing, a later
// "only one audio track" case would still find the previous test's sibling.
afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A selected `<audio>` with a sibling track, so carve — which needs another
 * track to listen to — is offered. Pass `alone` for a composition holding just
 * this one.
 */
function audioSelection(dataAttributes: Record<string, string>, alone = false): DomEditSelection {
  const bed = document.createElement("audio");
  bed.id = "bed";
  document.body.append(bed);
  if (!alone) {
    const voice = document.createElement("audio");
    voice.id = "vo";
    document.body.append(voice);
  }
  return { dataAttributes, id: "bed", element: bed } as unknown as DomEditSelection;
}

function mount(dataAttributes: Record<string, string>, alone = false) {
  // Every write is quiet: persisted without the preview reload that would
  // restart every playing track, but with a selection resync so the panel sees
  // what it just wrote.
  const onSetAttributeQuiet = vi.fn();
  const onSetAttributeLive = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const selection = audioSelection(dataAttributes, alone);
  act(() => {
    createRoot(host).render(
      <AudioFxGroup
        element={selection}
        onSetAttributeQuiet={onSetAttributeQuiet}
        onSetAttributeLive={onSetAttributeLive}
      />,
    );
  });
  return { host, onSetAttributeQuiet, onSetAttributeLive };
}

const rowFor = (host: HTMLElement, label: string): HTMLElement | null => {
  for (const row of Array.from(host.querySelectorAll<HTMLElement>(".hf-fx-row"))) {
    if (row.querySelector(".hf-fx-label")?.textContent === label) return row;
  }
  return null;
};

const parseWrite = (call: unknown[]) => JSON.parse(String(call[1]));

describe("AudioFxGroup automation", () => {
  it("renders the chain's parameters", () => {
    const { host } = mount({ "fx-chain": CHAIN });
    expect(rowFor(host, "Cutoff")).toBeTruthy();
    expect(rowFor(host, "Q")).toBeTruthy();
  });

  it("seeds a new lane at the value the control already holds", () => {
    // Switching to an envelope must not change the sound — only where the value
    // comes from. The chain has frequency at 900, not the registry default.
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": CHAIN });
    const button = rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement;
    act(() => button.click());
    const [attr, value] = onSetAttributeQuiet.mock.calls[0];
    expect(attr).toBe("data-automation");
    expect(JSON.parse(String(value))).toEqual({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 900 }] }],
    });
  });

  it("keeps lanes it is not touching when adding one", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "volume", points: [{ t: 0, v: 0.5 }] }],
      }),
    });
    act(() => (rowFor(host, "Q")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click());
    expect(
      parseWrite(onSetAttributeQuiet.mock.calls[0]).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["volume", "fx.n1.q"]);
  });

  it("disables a control the timeline already drives", () => {
    const { host } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    const cutoff = rowFor(host, "Cutoff")!;
    expect(cutoff.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    expect(cutoff.hasAttribute("data-automated")).toBe(true);
    expect(
      rowFor(host, "Q")!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled,
    ).toBe(false);
  });

  it("deletes just that lane, handing the value back to the control", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [
          { target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] },
          { target: "volume", points: [{ t: 0, v: 0.5 }] },
        ],
      }),
    });
    act(() =>
      (rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click(),
    );
    expect(
      parseWrite(onSetAttributeQuiet.mock.calls[0]).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["volume"]);
  });

  it("clears the attribute when the last lane goes", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    act(() =>
      (rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click(),
    );
    // Null rather than "": the live path removes an attribute it is given null for.
    expect(onSetAttributeQuiet.mock.calls[0][1]).toBeNull();
  });

  it("ignores a lane for an effect that is no longer in the chain", () => {
    const { host } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.gone.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    // Nothing is automated, so every control stays live.
    expect(
      rowFor(host, "Cutoff")!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled,
    ).toBe(false);
  });
});

describe("AudioFxGroup carve", () => {
  const carvedChain = JSON.stringify({
    version: 1,
    nodes: [
      { type: "peaking", id: "n1", fromCarve: true, params: { frequency: 900, gain: -6, q: 1.4 } },
      { type: "lowpass", id: "n2", params: { frequency: 400, q: 0.9, poles: "2" } },
    ],
  });

  const carveOn = JSON.stringify({ source: "vo", strength: 0.5, dynamic: false });

  const carveToggle = (host: HTMLElement): HTMLButtonElement => {
    const block = host.querySelector(".hf-fx-carve")!;
    return block.querySelector(".hf-fx-bypass") as HTMLButtonElement;
  };

  it("removes the filters it generated when carve is switched off", async () => {
    // Leaving them behind would keep dipping the bed with no carve to explain it.
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": carveOn,
    });
    await act(async () => {
      carveToggle(host).click();
    });
    const chainWrite = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-chain");
    expect(chainWrite).toBeTruthy();
    const kept = JSON.parse(String(chainWrite![1])).nodes;
    expect(kept.map((n: { type: string }) => n.type)).toEqual(["lowpass"]);
    // And the carve settings themselves go — after the chain write, not
    // alongside it: both are read-modify-writes of the same file, so fired
    // together the later one reads pre-edit content and drops the earlier.
    expect(onSetAttributeQuiet.mock.calls.map((c) => c[0])).toEqual([
      "data-fx-chain",
      "data-fx-carve",
    ]);
    expect(onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-carve")?.[1]).toBeNull();
  });

  it("leaves a hand-built chain alone when carve is switched off", () => {
    const handBuilt = JSON.stringify({
      version: 1,
      nodes: [{ type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } }],
    });
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": handBuilt, "fx-carve": carveOn });
    act(() => carveToggle(host).click());
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-chain")).toBe(false);
  });

  it("drags a carve dial live and persists once on release", () => {
    // Without the split every pointermove patched the source file and resynced
    // the selection, which is what makes the audio stutter mid-drag.
    const { host, onSetAttributeQuiet, onSetAttributeLive } = mount({
      "fx-chain": carvedChain,
      "fx-carve": carveOn,
    });
    const dial = host.querySelector<HTMLInputElement>(".hf-fx-carve input[type=range]");
    expect(dial).not.toBeNull();
    act(() => {
      // React's value tracker swallows a plain assignment, so go through the
      // prototype setter the way the other panel tests do.
      // A different value than the carve holds; setting the same one is not a change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(dial, "0.8");
      dial?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSetAttributeLive.mock.calls.map((c) => c[0])).toEqual(["data-fx-carve"]);
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-carve")).toBe(false);
    act(() => dial?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-carve")).toBe(true);
  });

  it("writes carve settings live, so enabling it does not reload the preview", () => {
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": carvedChain });
    act(() => carveToggle(host).click());
    const write = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-carve");
    expect(write).toBeTruthy();
    expect(JSON.parse(String(write![1])).strength).toBeGreaterThan(0);
  });
});

describe("AudioFxGroup dynamic carve", () => {
  const carvedChain = JSON.stringify({
    version: 1,
    nodes: [{ type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } }],
  });
  // Strength 0 carves frequencies only — no level ducking — so the spectral
  // cases measure just the spectral half. A case that wants the duck raises it.
  const settings = (dynamic: boolean, over: Record<string, unknown> = {}) =>
    JSON.stringify({ source: "vo", strength: 0, dynamic, ...over });

  /** The value written for one attribute, whatever order the writes landed in. */
  const writeFor = (calls: unknown[][], attr: string) =>
    JSON.parse(String(calls.find((c) => c[0] === attr)![1]));

  /** Choose a voice track the way the select does. */
  const pickSource = (host: HTMLElement, id: string) => {
    const select = host.querySelector<HTMLSelectElement>(".hf-fx-carve select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const dynamicBox = (host: HTMLElement) =>
    host.querySelector<HTMLInputElement>(".hf-fx-carve-dynamic")!;

  /** A voice with a pause in it, decoded through a stubbed offline context. */
  function stubDecode(): void {
    const sampleRate = 48000;
    const data = new Float32Array(sampleRate * 4);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      data[i] = t > 1 && t < 3 ? 0.7 * Math.sin(2 * Math.PI * 1000 * t) : 0;
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData = async () => ({ sampleRate, getChannelData: () => data });
      },
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("records the choice in the carve settings", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": settings(false),
    });
    act(() => dynamicBox(host).click());
    const write = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-carve");
    expect(JSON.parse(String(write![1])).dynamic).toBe(true);
  });

  it("automates the carve filters' gain from the voice, in the bed's own time", async () => {
    stubDecode();
    // Voice starts 10s into the composition, bed at 0: the envelope is measured
    // against the voice but read from the start of the bed, so it has to shift.
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      // No source yet: picking one is what applies the carve.
      "fx-carve": settings(true, { source: "" }),
      start: "0",
    });
    const vo = document.getElementById("vo")!;
    vo.setAttribute("data-start", "10");
    vo.setAttribute("src", "voice.wav");
    await act(async () => {
      pickSource(host, "vo");
    });

    // Chain first, then automation: a lane naming a node the chain does not
    // carry yet is dropped when it is read back.
    const order = onSetAttributeQuiet.mock.calls.map((c) => c[0]);
    // The settings land first, then the filters they imply, then the envelopes.
    expect(order.indexOf("data-fx-chain")).toBeLessThan(order.indexOf("data-automation"));

    const carved = writeFor(onSetAttributeQuiet.mock.calls, "data-fx-chain").nodes;
    const carveNode = carved.find((n: { fromCarve?: boolean }) => n.fromCarve);
    expect(carveNode.id).toBeTruthy();

    const lanes = writeFor(onSetAttributeQuiet.mock.calls, "data-automation").lanes;
    const lane = lanes.find((l: { target: string }) => l.target === `fx.${carveNode.id}.gain`) as {
      points: { t: number; v: number }[];
    };
    expect(lane).toBeTruthy();
    // Flat at the bed's own start, before the voice exists at all.
    expect(lane.points[0]).toMatchObject({ t: 0, v: 0 });
    // The voice's pause is at 0-1s of its own clip, so 10-11s of the bed's.
    expect(lane.points.find((p) => p.t > 10.5 && p.t < 11)?.v ?? 0).toBe(0);
    // And it cuts once the voice speaks, a second later. Depth is per band and
    // relative to that band's own peak in the voice, so the invariant is that the
    // envelope gets most of the way to what the analysis put on the node — not a
    // fixed number of dB, which changes with the band the analysis chose.
    const bandGain = Number(carveNode.params?.gain ?? 0);
    // At least half the depth the analysis put on the node; the exact floor
    // depends on which band it chose and how the envelope was thinned.
    expect(Math.min(...lane.points.map((p) => p.v))).toBeLessThanOrEqual(bandGain * 0.5);
    // Ends back at no cut, so the bed is not left dipped for the rest of the clip.
    expect(lane.points.at(-1)!.v).toBe(0);
  });

  it("adds a gain stage that ducks the bed under the voice, automated when dynamic", async () => {
    // Carving frequencies cannot beat a bed that is simply louder than the
    // voice. The level half rides a gain node the carve owns, so the track's own
    // volume lane is left alone.
    stubDecode();
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": settings(true, { strength: 1, source: "" }),
      start: "0",
    });
    const vo = document.getElementById("vo")!;
    vo.setAttribute("data-start", "0");
    vo.setAttribute("src", "voice.wav");
    // The bed is measured too — "how far over the voice is it" needs both.
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");
    await act(async () => {
      pickSource(host, "vo");
    });

    const nodes = writeFor(onSetAttributeQuiet.mock.calls, "data-fx-chain").nodes;
    const gain = nodes.find((n: { type: string }) => n.type === "gain");
    expect(gain).toBeTruthy();
    expect(gain.fromCarve).toBe(true);
    // Dynamic hands the value to the envelope, so the static one stays at unity.
    expect(gain.params.gain).toBe(0);

    const lanes = writeFor(onSetAttributeQuiet.mock.calls, "data-automation").lanes;
    const duckLane = lanes.find((l: { target: string }) => l.target === `fx.${gain.id}.gain`);
    expect(duckLane).toBeTruthy();
    expect(Math.min(...duckLane.points.map((p: { v: number }) => p.v))).toBeLessThan(0);
    // Every carved band gets an envelope reaching that band's own analysed depth.
    for (const node of nodes.filter((n: { type: string }) => n.type === "peaking")) {
      const lane = lanes.find((l: { target: string }) => l.target === `fx.${node.id}.gain`) as
        | { points: { v: number }[] }
        | undefined;
      expect(lane, `band ${node.id} has no envelope`).toBeTruthy();
      const deepest = Math.min(...lane!.points.map((p) => p.v));
      expect(deepest).toBeLessThanOrEqual(0);
      expect(deepest).toBeGreaterThanOrEqual(node.params.gain - 0.2);
      expect(deepest).toBeLessThanOrEqual(node.params.gain * 0.5);
    }
    // The author's own volume lane is not something a carve gets to touch.
    expect(lanes.some((l: { target: string }) => l.target === "volume")).toBe(false);
  });

  it("holds one measured value when the carve is not dynamic", async () => {
    stubDecode();
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": settings(false, { strength: 1, source: "" }),
      start: "0",
    });
    const vo = document.getElementById("vo")!;
    vo.setAttribute("data-start", "0");
    vo.setAttribute("src", "voice.wav");
    // The bed is measured too — "how far over the voice is it" needs both.
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");
    await act(async () => {
      pickSource(host, "vo");
    });
    const nodes = writeFor(onSetAttributeQuiet.mock.calls, "data-fx-chain").nodes;
    const gain = nodes.find((n: { type: string }) => n.type === "gain");
    expect(gain.params.gain).toBeLessThan(0);
    // Nothing to schedule: a static carve is a value, not an envelope.
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-automation")).toBe(false);
  });

  it("carves frequencies only when the duck is off", async () => {
    stubDecode();
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": settings(true, { strength: 0, source: "" }),
      start: "0",
    });
    document.getElementById("vo")!.setAttribute("src", "voice.wav");
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");
    await act(async () => {
      pickSource(host, "vo");
    });
    const nodes = writeFor(onSetAttributeQuiet.mock.calls, "data-fx-chain").nodes;
    expect(nodes.some((n: { type: string }) => n.type === "gain")).toBe(false);
  });

  it("applies as soon as a voice track is picked, with no second step", async () => {
    // A carve with a source and no filters is a setting nobody applied. Choosing
    // the voice is the whole gesture.
    stubDecode();
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": JSON.stringify({ version: 1, nodes: [] }),
      "fx-carve": JSON.stringify({ source: "", strength: 0.25, dynamic: true }),
      start: "0",
    });
    document.getElementById("vo")!.setAttribute("src", "voice.wav");
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");
    await act(async () => {
      pickSource(host, "vo");
    });
    const written = onSetAttributeQuiet.mock.calls.map((c) => c[0]);
    expect(written).toEqual(["data-fx-carve", "data-fx-chain", "data-automation"]);
    const nodes = JSON.parse(
      String(onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-chain")![1]),
    ).nodes;
    expect(nodes.every((n: { fromCarve?: boolean }) => n.fromCarve)).toBe(true);
  });

  it("re-applies when dynamic is switched on, not just when strength moves", async () => {
    stubDecode();
    const carvedAlready = JSON.stringify({
      version: 1,
      nodes: [
        {
          type: "peaking",
          id: "n1",
          fromCarve: true,
          params: { frequency: 1000, gain: -6, q: 1.4 },
        },
      ],
    });
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedAlready,
      "fx-carve": settings(false, { strength: 0.25 }),
      start: "0",
    });
    document.getElementById("vo")!.setAttribute("src", "voice.wav");
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");
    await act(async () => {
      host.querySelector<HTMLInputElement>(".hf-fx-carve-dynamic")!.click();
    });
    // Static and dynamic are different chains, so the switch has to rebuild them.
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-chain")).toBe(true);
  });

  it("re-applies an existing carve when strength moves", async () => {
    // Strength is the whole control surface, so it has to act on what is already
    // applied. Left to the button alone, a carve kept the filters and envelopes
    // its old strength produced and the knob silently described nothing.
    stubDecode();
    const carvedAlready = JSON.stringify({
      version: 1,
      nodes: [
        {
          type: "peaking",
          id: "n1",
          fromCarve: true,
          params: { frequency: 1000, gain: -6, q: 1.4 },
        },
        { type: "gain", id: "n2", fromCarve: true, params: { gain: -6 } },
      ],
    });
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedAlready,
      "fx-carve": settings(true, { strength: 0.25 }),
      start: "0",
    });
    document.getElementById("vo")!.setAttribute("src", "voice.wav");
    document.getElementById("bed")!.setAttribute("src", "bed.m4a");

    const dial = host.querySelector<HTMLInputElement>(".hf-fx-carve input[type=range]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(dial, "1");
      dial.dispatchEvent(new Event("input", { bubbles: true }));
      dial.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    const written = onSetAttributeQuiet.mock.calls.map((c) => c[0]);
    expect(written).toContain("data-fx-carve");
    // The settings land first, then the filters they imply, then the envelopes.
    expect(written.indexOf("data-fx-carve")).toBeLessThan(written.indexOf("data-fx-chain"));
    expect(written.indexOf("data-fx-chain")).toBeLessThan(written.indexOf("data-automation"));

    const chainWrite = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-chain");
    const nodes = JSON.parse(String(chainWrite![1])).nodes;
    // Full strength: deeper than the 6 dB the quarter-strength carve had.
    const deepest = Math.min(
      ...nodes
        .filter((n: { type: string }) => n.type === "peaking")
        .map((n: { params: { gain: number } }) => n.params.gain),
    );
    expect(deepest).toBeLessThan(-6);
  });

  it("does nothing but record the setting while no voice track is chosen", async () => {
    // There is nothing to listen to, so there is nothing to derive. This is the
    // one case that only writes the setting now that the apply button is gone.
    stubDecode();
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": JSON.stringify({ version: 1, nodes: [] }),
      "fx-carve": settings(true, { strength: 0.25, source: "" }),
      start: "0",
    });
    const dial = host.querySelector<HTMLInputElement>(".hf-fx-carve input[type=range]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(dial, "1");
      dial.dispatchEvent(new Event("input", { bubbles: true }));
      dial.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    expect(onSetAttributeQuiet.mock.calls.map((c) => c[0])).toEqual(["data-fx-carve"]);
  });

  it("does not re-analyse on every pixel of a drag", async () => {
    // Only the release re-applies. Analysing per pointermove would decode both
    // tracks on each pixel.
    stubDecode();
    const carvedAlready = JSON.stringify({
      version: 1,
      nodes: [
        {
          type: "peaking",
          id: "n1",
          fromCarve: true,
          params: { frequency: 1000, gain: -6, q: 1.4 },
        },
      ],
    });
    const { host, onSetAttributeQuiet, onSetAttributeLive } = mount({
      "fx-chain": carvedAlready,
      "fx-carve": settings(true, { strength: 0.25 }),
      start: "0",
    });
    document.getElementById("vo")!.setAttribute("src", "voice.wav");
    const dial = host.querySelector<HTMLInputElement>(".hf-fx-carve input[type=range]")!;
    await act(async () => {
      for (const v of ["0.4", "0.6", "0.8"]) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(dial, v);
        dial.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(onSetAttributeLive.mock.calls.every((c) => c[0] === "data-fx-carve")).toBe(true);
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-chain")).toBe(false);
  });

  it("drops the envelopes when dynamic is switched back off", async () => {
    // An automated gain ignores the panel's depth, so leaving the lanes behind
    // would keep the filters following a voice with nothing saying they do.
    const automation = JSON.stringify({
      version: 1,
      lanes: [
        { target: "fx.n2.gain", points: [{ t: 0, v: 0 }] },
        { target: "volume", points: [{ t: 0, v: 1 }] },
      ],
    });
    const withCarveNode = JSON.stringify({
      version: 1,
      nodes: [
        { type: "peaking", id: "n2", fromCarve: true, params: { frequency: 1000, gain: -6 } },
      ],
    });
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": withCarveNode,
      "fx-carve": settings(true),
      automation,
    });
    await act(async () => {
      dynamicBox(host).click();
    });
    const write = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-automation");
    expect(write).toBeTruthy();
    const lanes = JSON.parse(String(write![1])).lanes;
    expect(lanes.map((l: { target: string }) => l.target)).toEqual(["volume"]);
  });
});

describe("AudioFxGroup successive edits", () => {
  const three = JSON.stringify({
    version: 1,
    nodes: [
      { type: "peaking", id: "n1", params: { frequency: 900, gain: -6, q: 1.4 } },
      { type: "lowpass", id: "n2", params: { frequency: 400, q: 0.9, poles: "2" } },
      { type: "delay", id: "n3", params: { time: 250, feedback: 0.3, mix: 0.4 } },
    ],
  });

  const removeButtons = (host: HTMLElement) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove"));

  /**
   * The panel computes each edit from the attribute it is holding. Written
   * without a selection resync, the second delete worked from the pre-delete
   * chain and wrote the same result — so after deleting one effect, no further
   * delete did anything.
   */
  it("deletes a second effect after the first, not from a stale chain", () => {
    const first = mount({ "fx-chain": three });
    act(() => removeButtons(first.host)[0]!.click());
    const afterFirst = JSON.parse(String(first.onSetAttributeQuiet.mock.calls[0][1]));
    expect(afterFirst.nodes.map((n: { id: string }) => n.id)).toEqual(["n2", "n3"]);

    // The resync hands the panel what it just wrote; the next delete starts there.
    const second = mount({ "fx-chain": JSON.stringify(afterFirst) });
    act(() => removeButtons(second.host)[0]!.click());
    const afterSecond = JSON.parse(String(second.onSetAttributeQuiet.mock.calls[0][1]));
    expect(afterSecond.nodes.map((n: { id: string }) => n.id)).toEqual(["n3"]);

    const third = mount({ "fx-chain": JSON.stringify(afterSecond) });
    act(() => removeButtons(third.host)[0]!.click());
    // The last one leaves no chain at all.
    expect(third.onSetAttributeQuiet.mock.calls[0][1]).toBeNull();
  });

  it("writes with the commit that resyncs the selection, not the silent one", () => {
    // Both skip the preview reload; only this one re-reads the selection, which
    // is what makes a following edit see the current value.
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": three });
    act(() => removeButtons(host)[0]!.click());
    expect(onSetAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetAttributeQuiet.mock.calls[0][0]).toBe("data-fx-chain");
  });
});

describe("AudioFxGroup carve visibility", () => {
  /**
   * A carve is a relationship: a bed is carved *against* a voice. The voice is the
   * other end of it, so offering the same control there is offering to carve a
   * track against itself by proxy — and switching it on left a setting that could
   * never do anything.
   */
  it("does not offer carve on a track another track is carving against", () => {
    const bed = document.createElement("audio");
    bed.id = "bed";
    bed.setAttribute("src", "bed.m4a");
    bed.setAttribute("data-fx-carve", JSON.stringify({ source: "vo", strength: 0.25 }));
    document.body.append(bed);
    const voice = document.createElement("audio");
    voice.id = "vo";
    voice.setAttribute("src", "voice.wav");
    document.body.append(voice);

    const host = document.createElement("div");
    document.body.append(host);
    const selection = {
      dataAttributes: {},
      id: "vo",
      element: voice,
    } as unknown as DomEditSelection;
    act(() => {
      createRoot(host).render(
        <AudioFxGroup
          element={selection}
          onSetAttributeQuiet={vi.fn()}
          onSetAttributeLive={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".hf-fx-carve")).toBeNull();
  });

  it("still offers it on the bed doing the carving", () => {
    const bed = document.createElement("audio");
    bed.id = "bed";
    bed.setAttribute("src", "bed.m4a");
    bed.setAttribute("data-fx-carve", JSON.stringify({ source: "vo", strength: 0.25 }));
    document.body.append(bed);
    const voice = document.createElement("audio");
    voice.id = "vo";
    voice.setAttribute("src", "voice.wav");
    document.body.append(voice);

    const host = document.createElement("div");
    document.body.append(host);
    const selection = {
      dataAttributes: { "fx-carve": JSON.stringify({ source: "vo", strength: 0.25 }) },
      id: "bed",
      element: bed,
    } as unknown as DomEditSelection;
    act(() => {
      createRoot(host).render(
        <AudioFxGroup
          element={selection}
          onSetAttributeQuiet={vi.fn()}
          onSetAttributeLive={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".hf-fx-carve")).not.toBeNull();
  });

  it("offers carve when the composition holds another audio track", () => {
    const { host } = mount({ "fx-chain": CHAIN });
    expect(host.querySelector(".hf-fx-carve")).toBeTruthy();
  });

  it("does not offer carve for the only audio track in the composition", () => {
    // Nothing to listen to, so the picker would be empty and Analyse inert.
    const { host } = mount({ "fx-chain": CHAIN }, true);
    expect(host.querySelector(".hf-fx-carve")).toBeNull();
  });
});

describe("AudioFxGroup deleting an effect", () => {
  const twoNodes = JSON.stringify({
    version: 1,
    nodes: [
      { type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } },
      { type: "peaking", id: "n2", params: { frequency: 900, gain: -6, q: 1 } },
    ],
  });

  it("takes the deleted node's lanes with it", () => {
    // resolveAutomation only hides an orphan at read time. Left in the attribute,
    // and with ids minted lowest-free, the next effect added takes the same id and
    // inherits the dead envelope — disabled and "Automated" without the author
    // ever automating it, and baked into the render.
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": twoNodes,
      automation: JSON.stringify({
        version: 1,
        lanes: [
          { target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] },
          { target: "fx.n2.gain", points: [{ t: 0, v: -6 }] },
          { target: "volume", points: [{ t: 0, v: 1 }] },
        ],
      }),
    });
    const remove = host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove")[0]!;
    act(() => remove.click());
    const automationWrite = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-automation");
    expect(automationWrite).toBeTruthy();
    expect(
      JSON.parse(String(automationWrite![1])).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["fx.n2.gain", "volume"]);
  });

  it("leaves automation alone when the deleted node had none", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": twoNodes,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n2.gain", points: [{ t: 0, v: -6 }] }],
      }),
    });
    act(() => host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove")[0]!.click());
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-automation")).toBe(false);
  });
});

describe("AudioFxGroup carve module readouts", () => {
  /**
   * A carve on a bed running 0–10 s, with a lane that ramps its 400 Hz band from
   * no cut to −6 dB across the first five seconds. The stored gain is −1, which is
   * deliberately not a value the lane ever passes through: it stands in for the
   * seed a lane leaves behind, so a readout showing it can only mean the playhead
   * was not consulted.
   */
  const carved = {
    start: "0",
    duration: "10",
    "fx-chain": JSON.stringify({
      version: 1,
      nodes: [
        {
          type: "peaking",
          id: "n1",
          fromCarve: true,
          params: { frequency: 400, gain: -1, q: 1.4 },
        },
      ],
    }),
    automation: JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "fx.n1.gain",
          points: [
            { t: 0, v: 0 },
            { t: 5, v: -6 },
          ],
        },
      ],
    }),
    "fx-carve": JSON.stringify({ source: "vo", strength: 0.25, dynamic: true }),
  };

  /** Park the playhead somewhere, paused — a scrub is the same question as playback. */
  const seek = (time: number) => {
    act(() => {
      usePlayerStore.setState({ currentTime: time, isPlaying: false });
    });
  };

  const gainReadout = (host: HTMLElement): HTMLElement | null => {
    for (const span of Array.from(host.querySelectorAll<HTMLElement>(".hf-fx-carve-member span"))) {
      if (span.textContent?.startsWith("Gain")) return span;
    }
    return null;
  };

  const openModule = (host: HTMLElement) => {
    const head = host.querySelector<HTMLButtonElement>(".hf-fx-carve-module .hf-fx-node-name");
    act(() => head?.click());
  };

  afterEach(() => {
    usePlayerStore.setState({ currentTime: 0, isPlaying: false });
  });

  it("shows the envelope's value at the playhead, not the stored seed", () => {
    seek(2.5);
    const { host } = mount(carved);
    openModule(host);
    const gain = gainReadout(host);
    // Halfway along a 0 → −6 dB ramp.
    expect(gain?.textContent).toContain("-3 dB");
    expect(gain?.hasAttribute("data-automation-live")).toBe(true);
  });

  it("follows the playhead as it moves", () => {
    seek(0);
    const { host } = mount(carved);
    openModule(host);
    expect(gainReadout(host)?.textContent).toContain("0 dB");
    seek(5);
    expect(gainReadout(host)?.textContent).toContain("-6 dB");
    seek(1);
    expect(gainReadout(host)?.textContent).toContain("-1.2 dB");
  });

  it("follows the transport during playback, off the live-time channel", async () => {
    // The RAF loop deliberately keeps every frame out of the store — it notifies
    // `liveTime` instead — so a panel that only watched the store would sit still
    // for the whole take and then jump when playback stopped.
    seek(0);
    const { host } = mount(carved);
    openModule(host);
    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });
    act(() => liveTime.notify(4));
    // Throttled to 30 Hz rather than rendered per frame, so the readout lands on
    // the next tick and not in this one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(gainReadout(host)?.textContent).toContain("-4.8 dB");

    act(() => liveTime.notify(5));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(gainReadout(host)?.textContent).toContain("-6 dB");
  });

  it("reserves the same width whatever the value reads", () => {
    // The readout updates 30 times a second while the transport runs, and a value
    // one character narrower shunts everything after it sideways. So the width comes
    // from what the parameter CAN read, not from what it currently does.
    seek(2.5);
    const { host } = mount(carved);
    openModule(host);
    const widthAt = (): string | undefined =>
      gainReadout(host)?.querySelector<HTMLElement>(".tabular-nums")?.style.minWidth;
    const narrow = widthAt();
    expect(narrow).toBe("8ch"); // -40..40 dB at one decimal: "-12.5 dB"
    seek(5); // -6 dB — two characters shorter than -3 dB was
    expect(gainReadout(host)?.textContent).toContain("-6 dB");
    expect(widthAt()).toBe(narrow);
  });

  it("moves a hand-built effect's own slider and number, not just the carve rack", () => {
    // Every automated value follows its lane, whatever put the effect there. This
    // one is a delay the author added and automated by hand: its control is locked
    // (the lane owns the value), so the fader has no drag to fight and can simply
    // show the truth.
    const { host } = mount({
      start: "0",
      duration: "10",
      "fx-chain": JSON.stringify({
        version: 1,
        nodes: [{ type: "delay", id: "n1", params: { time: 250, feedback: 0.35, mix: 0.4 } }],
      }),
      automation: JSON.stringify({
        version: 1,
        lanes: [
          {
            target: "fx.n1.mix",
            points: [
              { t: 0, v: 0 },
              { t: 4, v: 1 },
            ],
          },
        ],
      }),
    });
    const mixRow = rowFor(host, "Mix");
    const number = mixRow?.querySelector<HTMLInputElement>(".hf-fx-number");
    const slider = mixRow?.querySelector<HTMLInputElement>(".hf-fx-slider");
    expect(number?.disabled).toBe(true); // the lane owns it

    seek(1); // a quarter along a 0 → 1 ramp
    expect(Number(number?.value)).toBeCloseTo(0.25, 2);
    const quarter = Number(slider?.value);

    seek(3);
    expect(Number(number?.value)).toBeCloseTo(0.75, 2);
    expect(Number(slider?.value)).toBeGreaterThan(quarter);
  });

  it("shows the lane's own edge value off the clip, not the stored seed", () => {
    // Past the bed's end, where a lane holds its last value — which is what would
    // play if the playhead came back. The stored -1 dB is a seed the lane replaced
    // and nothing will ever use it, so putting it on screen only made the fader
    // jump when the clip came under the playhead.
    seek(20);
    const { host } = mount(carved);
    openModule(host);
    const gain = gainReadout(host);
    expect(gain?.textContent).toContain("-6 dB"); // the ramp's last point
    expect(gain?.hasAttribute("data-automation-live")).toBe(true);
    expect(gain?.hasAttribute("data-automated")).toBe(true);
  });

  it("holds the lane's first value before the clip starts", () => {
    // Same rule at the other end: a lane opens on its first point, so that is what
    // the fader should read while the playhead is still upstream of the clip.
    seek(-5);
    const { host } = mount(carved);
    openModule(host);
    expect(gainReadout(host)?.textContent).toContain("0 dB");
  });
});
