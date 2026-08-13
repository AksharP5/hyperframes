/**
 * The audio FX panel's bridge to the element/attribute world.
 *
 * Chain, carve and automation are all serialised onto the element the way colour
 * grading carries its config, so persistence is an ordinary attribute write with
 * no new server route. Split out of PropertyPanelFlat, which is at its size
 * budget, and self-contained enough to test on its own.
 */

import { useState } from "react";
import {
  defaultAudioFxParams,
  HF_AUDIO_FX_ATTR,
  mintAudioFxNodeId,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "@hyperframes/core/audio-fx";
import {
  analyseCarveBands,
  analyseCarveDuck,
  carveBandsToChain,
  carveProfile,
  HF_AUDIO_CARVE_ATTR,
  normalizeCarveSettings,
  type HfCarveSettings,
} from "@hyperframes/core/audio-carve";
import {
  fxAutomationTarget,
  sampleAutomationLane,
  type HfAutomation,
} from "@hyperframes/core/audio-automation";
import {
  automatedTargetsOf,
  automationAttrValue,
  HF_AUDIO_AUTOMATION_ATTR,
  readPanelAutomation,
  resolveAutomationRange,
  withoutLane,
  withSeededLane,
} from "./propertyPanelAutomation";
import type { DomEditSelection } from "./domEditingTypes";
import { useLivePlayheadTime } from "../../hooks/useLivePlayheadTime";

/**
 * Rate the carve source is decoded at. Analysis is self-consistent because it
 * reads the decoded buffer's own rate, so this only has to be a sane audio rate.
 */
const DECODE_SAMPLE_RATE = 48000;
import { FxSection, type AudioTrackOption } from "./propertyPanelFxSection.js";

/** Where a clip starts on the timeline, in seconds. */
function clipStart(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Lanes belonging to nodes the carve generated, which a re-run replaces. */
function withoutCarveLanes(automation: HfAutomation, chain: HfAudioFxChain): HfAutomation {
  const prefixes = chain.nodes.filter((n) => n.fromCarve && n.id).map((n) => `fx.${n.id}.`);
  if (prefixes.length === 0) return automation;
  return {
    version: automation.version,
    lanes: automation.lanes.filter((lane) => !prefixes.some((p) => lane.target.startsWith(p))),
  };
}

/**
 * Bridges the FX panel to the element/attribute world. Chain and carve are
 * serialised onto the element the way colour grading carries its config, so
 * persistence is an ordinary attribute write with no new server route.
 */
export function AudioFxGroup({
  element,
  onSetAttributeQuiet,
  onSetAttributeLive,
}: {
  element: DomEditSelection;
  /**
   * Every write here is quiet: it persists to the source and skips the preview
   * reload, because the runtime applies chain and automation edits to the
   * running graph — a reload would only interrupt the audio to reach the same
   * state, which is heard as the track chopping.
   *
   * It does re-read the selection afterwards, which this panel depends on: each
   * edit is computed from the current attribute, so without the resync a second
   * edit would work from a pre-edit value and appear to do nothing.
   */
  onSetAttributeQuiet: (attr: string, value: string | null) => void | Promise<void>;
  /** Continuous, non-persisting write for a dial being dragged. */
  onSetAttributeLive: (attr: string, value: string | null) => void | Promise<void>;
}) {
  const chain = ((): HfAudioFxChain => {
    const raw = element.dataAttributes?.["fx-chain"];
    if (!raw) return { version: 1, nodes: [] };
    try {
      return parseAudioFxChain(raw);
    } catch {
      // Show an unreadable chain as empty rather than breaking the panel; the
      // attribute is left untouched until the user changes something.
      return { version: 1, nodes: [] };
    }
  })();

  const automation = readPanelAutomation(element.dataAttributes?.["automation"], chain);
  const automatedTargets = automatedTargetsOf(automation);

  /**
   * What every automated knob is worth at the playhead, so the rack shows the
   * value the audio is actually using rather than the one the attribute stores.
   *
   * An automated parameter has two values: the number sitting in the chain, which
   * is only a seed once a lane exists, and the number the envelope is on right now.
   * The second is the true one, and a rack that shows the first reads as broken
   * during playback — the carve is visibly working and the readouts do not move.
   *
   * Sampled while paused as well, because the same argument applies to a scrub:
   * the playhead is somewhere, and the envelope has a value there.
   *
   * Sampled off the clip too, which is not obvious. A lane holds its first value
   * backwards and its last value forwards, so before the clip starts it already
   * knows what it will open on — while the stored number is a seed the lane
   * replaced and nothing will ever play. Showing that seed put a value on screen
   * that the automation never uses, and made the fader jump the moment the clip
   * came under the playhead.
   */
  const playhead = useLivePlayheadTime();
  const localTime = playhead - clipStart(element.dataAttributes?.["start"]);
  const liveAutomationValues = ((): Map<string, number> => {
    const values = new Map<string, number>();
    for (const lane of automation.lanes) {
      const range = resolveAutomationRange(lane.target, chain);
      if (!range) continue;
      values.set(lane.target, sampleAutomationLane(lane, localTime, range.scale));
    }
    return values;
  })();

  // Written through the live path on purpose. It persists to the source just
  // like the refreshing one, but skips the preview reload — and a reload
  // restarts every playing track, which is heard as the audio chopping. The
  // runtime follows the attribute and swaps the graph in place instead.
  const writeAutomation = (next: HfAutomation): void => {
    void onSetAttributeQuiet(HF_AUDIO_AUTOMATION_ATTR, automationAttrValue(next) || null);
  };

  /**
   * Start automating one effect parameter.
   *
   * The lane is seeded with a single point at the value the control currently
   * holds, so switching to an envelope never changes the sound — it only moves
   * where the value comes from. The author then adds points in the timeline.
   */
  const automateParam = (nodeId: string, paramKey: string): void => {
    const target = fxAutomationTarget(nodeId, paramKey);
    const node = chain.nodes.find((n) => n.id === nodeId);
    const range = resolveAutomationRange(target, chain);
    if (!node || !range) return;
    const raw = node.params?.[paramKey];
    writeAutomation(
      withSeededLane(automation, target, typeof raw === "number" ? raw : range.default),
    );
  };

  /** Stop automating it, handing the value back to the panel control. */
  const removeParamAutomation = (nodeId: string, paramKey: string): void => {
    writeAutomation(withoutLane(automation, fxAutomationTarget(nodeId, paramKey)));
  };

  /**
   * Turn carve on or off.
   *
   * Switching off drops the filters it generated — left behind they keep dipping
   * the bed with nothing in the panel to explain them — but that is a second
   * attribute, and each write is a read-modify-write against the same source
   * file. Fired together, both read the same content and the later one drops the
   * earlier: either the carve settings went and the filters stayed, or the
   * reverse. Awaiting the first means the second reads the file it produced.
   *
   * One commit carrying both would also close the window where a failure of just
   * the second leaves them half-applied; that needs a multi-attribute quiet
   * commit, which does not exist yet.
   */
  const setCarve = async (next: HfCarveSettings | null): Promise<void> => {
    if (!next) {
      const carriedOver = withoutCarveLanes(automation, chain);
      if (carriedOver.lanes.length !== automation.lanes.length) {
        await onSetAttributeQuiet(
          HF_AUDIO_AUTOMATION_ATTR,
          automationAttrValue(carriedOver) || null,
        );
      }
    }
    if (!next) {
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      if (kept.length !== chain.nodes.length) {
        await onSetAttributeQuiet(
          HF_AUDIO_FX_ATTR,
          kept.length ? serializeAudioFxChain({ version: 1, nodes: kept }) : null,
        );
      }
    }
    await onSetAttributeQuiet(HF_AUDIO_CARVE_ATTR, next ? JSON.stringify(next) : null);

    // Every setting here describes the filters, so changing one rebuilds them.
    // There is no apply button: a carve naming a voice with no filters behind it
    // is a setting nobody applied, and the panel already knows everything it needs
    // to. Picking the voice is what starts it; strength and dynamic re-derive what
    // is already there. A carve with no source yet has nothing to analyse.
    const changed =
      next &&
      next.sources.length > 0 &&
      (!carve ||
        next.sources.join(" ") !== carve.sources.join(" ") ||
        next.strength !== carve.strength);
    if (next && changed) await analyse(next);
  };

  /** Every lane belonging to a node that is going away. */
  const removeNodeAutomation = (nodeId: string): void => {
    const prefix = `fx.${nodeId}.`;
    const kept = automation.lanes.filter((lane) => !lane.target.startsWith(prefix));
    if (kept.length !== automation.lanes.length) {
      writeAutomation({ version: 1, lanes: kept });
    }
  };

  const carve = ((): HfCarveSettings | null => {
    const raw = element.dataAttributes?.["fx-carve"];
    if (!raw) return null;
    try {
      return normalizeCarveSettings(JSON.parse(raw));
    } catch {
      return null;
    }
  })();

  /**
   * Is some other track carving against this one?
   *
   * A carve is a relationship — a bed is carved against a voice — and the voice is
   * the far end of it. Offering the same control there offers to carve a track
   * against itself by proxy, and switching it on left a setting with no source it
   * could legally name. Read off the other elements' own carve attributes, because
   * that is where the relationship is recorded.
   */
  const carvedAgainstBy = ((): string | null => {
    const doc = element.element?.ownerDocument;
    if (!doc || !element.id) return null;
    for (const other of Array.from(doc.querySelectorAll<HTMLElement>(`[${HF_AUDIO_CARVE_ATTR}]`))) {
      if (other.id === element.id) continue;
      try {
        const raw = other.getAttribute(HF_AUDIO_CARVE_ATTR);
        if (raw && normalizeCarveSettings(JSON.parse(raw)).sources.includes(element.id)) {
          return other.id || "another track";
        }
      } catch {
        // An unreadable carve on some other element says nothing about this one.
      }
    }
    return null;
  })();

  const sourceOptions: AudioTrackOption[] = (() => {
    const doc = element.element?.ownerDocument;
    if (!doc) return [];
    return Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[id]"))
      .filter((a) => a.id !== element.id)
      .map((a) => ({ id: a.id, label: a.id }));
  })();

  const [analysing, setAnalysing] = useState(false);

  /**
   * Decodes the chosen voice track and turns its spectrum into peaking filters
   * on this one. The bands replace any previous carve output but leave
   * hand-added effects alone, so re-analysing does not discard other work.
   */
  const analyse = async (active: HfCarveSettings | null = carve): Promise<void> => {
    const activeSource = active?.sources[0];
    if (!activeSource) return;
    const doc = element.element?.ownerDocument;
    const voice = doc?.getElementById(activeSource) as HTMLAudioElement | null;
    const src = voice?.getAttribute("src");
    if (!src) return;
    setAnalysing(true);
    try {
      // Decoded in an OfflineAudioContext, not a live one. Opening a second
      // output device mid-playback makes the running track glitch while the
      // hardware is reconfigured; an offline context touches no device.
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return;
      const decode = async (relative: string): Promise<AudioBuffer> => {
        const res = await fetch(new URL(relative, doc!.baseURI).href);
        return new Ctor(1, 1, DECODE_SAMPLE_RATE).decodeAudioData(await res.arrayBuffer());
      };
      const buffer = await decode(src);
      // Strength is what the author set; these are the numbers it means.
      const profile = carveProfile(active.strength);
      // The bed as well as the voice, when the carve is asked to match levels:
      // "how far over the voice is this bed" cannot be answered by listening to
      // one of them.
      const bedSrc = profile.duckDb > 0 ? element.element?.getAttribute("src") : null;
      const bedBuffer = bedSrc ? await decode(bedSrc).catch(() => null) : null;
      const bands = analyseCarveBands(buffer.getChannelData(0), buffer.sampleRate, profile);
      const carved = carveBandsToChain(bands);

      // The level half of the carve, measured against the voice it has to sit
      // under. Times come back relative to the voice clip; the gap between the
      // two clips' starts is what aligns them.
      const offset =
        clipStart(voice?.getAttribute("data-start")) - clipStart(element.dataAttributes?.["start"]);
      const duck = bedBuffer
        ? analyseCarveDuck(
            buffer.getChannelData(0),
            bedBuffer.getChannelData(0),
            buffer.sampleRate,
            profile,
            offset,
          )
        : [];
      // Static carve holds one value, so the level match becomes the duck the
      // voice needs while it is actually speaking — the median of it, which
      // ignores both the pauses and any single loudest bar.
      const speaking = duck.filter((p) => p.v < 0).map((p) => p.v);
      const staticDuckDb = speaking.length
        ? (speaking.sort((a, b) => a - b)[Math.floor(speaking.length / 2)] ?? 0)
        : 0;

      // Carve output is tagged so a re-run replaces it instead of stacking.
      const kept = chain.nodes.filter((n) => !n.fromCarve);
      // Ids, minted against the nodes already claiming one, because a dynamic
      // carve automates these filters and a lane addresses its node by id.
      let claimed: HfAudioFxChain = { version: 1, nodes: kept };
      const mint = (node: HfAudioFxNode): HfAudioFxNode => {
        const withId = { ...node, id: mintAudioFxNodeId(claimed), fromCarve: true };
        claimed = { version: 1, nodes: [...claimed.nodes, withId] };
        return withId;
      };
      const carvedNodes: HfAudioFxNode[] = carved.nodes.map(mint);
      // The gain stage sits after the filters, and only exists when the carve was
      // asked to make level room, holding the one value computed above.
      const duckNode =
        duck.length > 0
          ? mint({
              type: "gain",
              enabled: true,
              params: { ...defaultAudioFxParams("gain"), gain: staticDuckDb },
            })
          : null;
      const next = {
        version: 1,
        nodes: [...carvedNodes, ...(duckNode ? [duckNode] : []), ...kept],
      };
      // Live, like every other chain write: the runtime swaps the graph in
      // place, so a reload would only interrupt the audio to reach the same
      // filters.
      //
      // Awaited, because the automation write below is a second read-modify-write
      // against the same file — fired together the later one would drop the
      // earlier — and because a lane naming a node the chain does not have yet is
      // pruned when it is read back.
      await onSetAttributeQuiet(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));

      // A carve written before dynamic mode was removed may still carry the
      // envelope lanes it automated; a re-run is static now, so they are stale.
      const carriedOver = withoutCarveLanes(automation, chain);
      if (carriedOver.lanes.length !== automation.lanes.length) {
        writeAutomation(carriedOver);
      }
    } catch {
      // Leave the chain as it was; the button simply re-enables.
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <FxSection
      chain={chain}
      automatedTargets={automatedTargets}
      liveAutomationValues={liveAutomationValues}
      onAutomateParam={automateParam}
      onRemoveParamAutomation={removeParamAutomation}
      onRemoveNodeAutomation={removeNodeAutomation}
      onChainChange={(next) =>
        // Live for the same reason as automation above: adding, removing or
        // bypassing an effect is applied to the running graph, so a reload would
        // only interrupt the audio to reach the same state.
        onSetAttributeQuiet(
          HF_AUDIO_FX_ATTR,
          next.nodes.length ? serializeAudioFxChain(next) : null,
        )
      }
      onChainPreview={(next) =>
        // Live writes skip the preview refresh entirely, so dragging a knob no
        // longer reloads the composition and restarts playback on every pixel.
        // The gesture-end write above is the one that resyncs.
        onSetAttributeLive(HF_AUDIO_FX_ATTR, next.nodes.length ? serializeAudioFxChain(next) : null)
      }
      carve={carve}
      onCarveChange={(next) => void setCarve(next)}
      onCarvePreview={(next) => onSetAttributeLive(HF_AUDIO_CARVE_ATTR, JSON.stringify(next))}
      sourceOptions={sourceOptions}
      carvedAgainstBy={carvedAgainstBy}
      analysing={analysing}
    />
  );
}
