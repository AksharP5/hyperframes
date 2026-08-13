// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  automationLaneLabel,
  automationLaneLabelParts,
  elementAutomation,
  elementFxChain,
} from "./automationLaneData";
import type { TimelineElement } from "../store/timelineElement";

const el = (over: Partial<TimelineElement> = {}): TimelineElement => ({
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 10,
  track: 10,
  ...over,
});

/** The chain as the lane code sees it: parsed, not the attribute text. */
const parseChain = (chain: unknown) => elementFxChain(el({ fxChain: JSON.stringify(chain) }))!;

const CHAIN = JSON.stringify({
  version: 1,
  nodes: [{ type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } }],
});
const LANE = JSON.stringify({
  version: 1,
  lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
});

describe("automationLaneData", () => {
  it("returns the same object for the same attributes", () => {
    // The lane compares its drag draft against this identity; a fresh object per
    // playhead tick would drop the drag.
    const a = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    const b = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    expect(a).toBe(b);
    expect(elementFxChain(el({ fxChain: CHAIN }))).toBe(elementFxChain(el({ fxChain: CHAIN })));
  });

  it("re-parses when the chain changes even though the automation text did not", () => {
    const withChain = elementAutomation(el({ automation: LANE, fxChain: CHAIN }));
    const withoutChain = elementAutomation(el({ automation: LANE }));
    expect(withChain.lanes.map((l) => l.target)).toEqual(["fx.n1.frequency"]);
    // No chain to resolve against, so the fx lane is dropped rather than drawn.
    expect(withoutChain.lanes).toEqual([]);
  });

  it("keeps a hot entry alive when other elements push the cache past its limit", () => {
    // Eviction used to clear the whole map, which changed every lane's identity
    // at once and released any drag in progress.
    const hot = el({ automation: LANE, fxChain: CHAIN });
    const first = elementAutomation(hot);
    for (let i = 0; i < 40; i += 1) {
      elementAutomation(
        el({
          automation: JSON.stringify({
            version: 1,
            lanes: [{ target: "volume", points: [{ t: i, v: 0.5 }] }],
          }),
        }),
      );
      elementAutomation(hot);
    }
    expect(elementAutomation(hot)).toBe(first);
  });

  it("reads an unreadable attribute as nothing rather than throwing", () => {
    expect(elementAutomation(el({ automation: "{nope" })).lanes).toEqual([]);
    expect(elementFxChain(el({ fxChain: "{nope" }))).toBeNull();
  });

  describe("lane order", () => {
    // A stack of EQ bands reads as a spectrum, so it has to be laid out like one:
    // the top of the stack is the top of the audible range. Attribute order is
    // whatever the carve happened to mint, which is the opposite — bands come out
    // ascending.
    const bandChain = JSON.stringify({
      version: 1,
      nodes: [
        { type: "peaking", id: "n1", params: { frequency: 400, gain: -6, q: 1.4 } },
        { type: "peaking", id: "n2", params: { frequency: 1600, gain: -9, q: 1.4 } },
        { type: "peaking", id: "n3", params: { frequency: 1000, gain: -3, q: 1.4 } },
        { type: "gain", id: "n4", params: { gain: -6 } },
      ],
    });
    const bandLanes = JSON.stringify({
      version: 1,
      lanes: [
        { target: "volume", points: [{ t: 0, v: 1 }] },
        { target: "fx.n1.gain", points: [{ t: 0, v: -6 }] },
        { target: "fx.n2.gain", points: [{ t: 0, v: -9 }] },
        { target: "fx.n3.gain", points: [{ t: 0, v: -3 }] },
        { target: "fx.n4.gain", points: [{ t: 0, v: -6 }] },
      ],
    });

    it("puts the highest frequency at the top", () => {
      const lanes = elementAutomation(el({ automation: bandLanes, fxChain: bandChain })).lanes;
      expect(lanes.map((l) => l.target)).toEqual([
        "fx.n2.gain", // 1.6 kHz
        "fx.n3.gain", // 1 kHz
        "fx.n1.gain", // 400 Hz
        // Neither of these is a band, so they sit under the spectrum in the order
        // they were written.
        "volume",
        "fx.n4.gain",
      ]);
    });

    it("keeps the same object identity, so a drag survives the sort", () => {
      const a = elementAutomation(el({ automation: bandLanes, fxChain: bandChain }));
      const b = elementAutomation(el({ automation: bandLanes, fxChain: bandChain }));
      expect(a).toBe(b);
    });
  });

  describe("automationLaneLabel", () => {
    const chain = parseChain({
      version: 1,
      nodes: [
        { type: "peaking", id: "n1", params: { frequency: 1600, gain: -9, q: 1.4 } },
        { type: "peaking", id: "n2", params: { frequency: 400, gain: -6, q: 1.4 } },
        { type: "gain", id: "n3", params: { gain: -6 } },
      ],
    });

    it("names the effect and the band it sits at", () => {
      // Three lanes all reading "Peaking EQ · Gain" say nothing about which band
      // each one is; a bare frequency does not say whether it is a bell or a
      // shelf. Both, then the parameter.
      expect(automationLaneLabel("fx.n1.gain", chain)).toBe("Peaking EQ 1.6 kHz · Gain");
      expect(automationLaneLabel("fx.n2.gain", chain)).toBe("Peaking EQ 400 Hz · Gain");
    });

    it("falls back to the effect's name when it has no frequency", () => {
      expect(automationLaneLabel("fx.n3.gain", chain)).toBe("Gain · Gain");
      expect(automationLaneLabel("volume", chain)).toBe("Volume");
    });

    it("has nothing to say about a target that does not resolve", () => {
      expect(automationLaneLabel("fx.gone.gain", chain)).toBeNull();
      expect(automationLaneLabelParts("fx.gone.gain", chain)).toBeNull();
    });

    it("splits the name from the parameter, which the column stacks", () => {
      expect(automationLaneLabelParts("fx.n1.gain", chain)).toEqual({
        name: "Peaking EQ 1.6 kHz",
        param: "Gain",
      });
      expect(automationLaneLabelParts("fx.n3.gain", chain)).toEqual({
        name: "Gain",
        param: "Gain",
      });
      // Volume is one word with no effect behind it, so there is no second line.
      expect(automationLaneLabelParts("volume", chain)).toEqual({ name: "Volume", param: "" });
    });
  });
});
