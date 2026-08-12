/**
 * The audio FX panel's bridge to the element/attribute world.
 *
 * Chain and carve are serialised onto the element the way colour grading carries
 * its config, so persistence is an ordinary attribute write with no new server
 * route. Split out of PropertyPanelFlat, which is at its size budget.
 */

import { useState } from "react";
import {
  HF_AUDIO_FX_ATTR,
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import {
  analyseCarveBands,
  carveBandsToChain,
  HF_AUDIO_CARVE_ATTR,
  normalizeCarveSettings,
  type HfCarveSettings,
} from "@hyperframes/core/audio-carve";
import type { DomEditSelection } from "./domEditing";
import { FxSection, type AudioTrackOption } from "./propertyPanelFxSection";

/**
 * Bridges the FX panel to the element/attribute world. Chain and carve are
 * serialised onto the element the way colour grading carries its config, so
 * persistence is an ordinary attribute write with no new server route.
 */
export function AudioFxGroup({
  element,
  onSetAttribute,
  onSetAttributeLive,
}: {
  element: DomEditSelection;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
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

  const carve = ((): HfCarveSettings | null => {
    const raw = element.dataAttributes?.["fx-carve"];
    if (!raw) return null;
    try {
      return normalizeCarveSettings(JSON.parse(raw));
    } catch {
      return null;
    }
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
  const analyse = async (): Promise<void> => {
    if (!carve?.source) return;
    const doc = element.element?.ownerDocument;
    const voice = doc?.getElementById(carve.source) as HTMLAudioElement | null;
    const src = voice?.getAttribute("src");
    if (!src) return;
    setAnalysing(true);
    try {
      const res = await fetch(new URL(src, doc!.baseURI).href);
      const bytes = await res.arrayBuffer();
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      try {
        const buffer = await ctx.decodeAudioData(bytes);
        const bands = analyseCarveBands(buffer.getChannelData(0), buffer.sampleRate, carve);
        const carved = carveBandsToChain(bands);
        // Carve output is tagged so a re-run replaces it instead of stacking.
        const kept = chain.nodes.filter((n) => !n.fromCarve);
        const next = {
          version: 1,
          nodes: [...carved.nodes.map((n) => ({ ...n, fromCarve: true })), ...kept],
        };
        onSetAttribute(HF_AUDIO_FX_ATTR, serializeAudioFxChain(next));
      } finally {
        void ctx.close().catch(() => undefined);
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
      onChainChange={(next) =>
        onSetAttribute(HF_AUDIO_FX_ATTR, next.nodes.length ? serializeAudioFxChain(next) : "")
      }
      onChainPreview={(next) =>
        // Live writes skip the preview refresh, so dragging a knob no longer
        // reloads the composition and restarts playback on every pixel.
        onSetAttributeLive(HF_AUDIO_FX_ATTR, next.nodes.length ? serializeAudioFxChain(next) : null)
      }
      carve={carve}
      onCarveChange={(next) =>
        onSetAttribute(HF_AUDIO_CARVE_ATTR, next ? JSON.stringify(next) : "")
      }
      sourceOptions={sourceOptions}
      onAnalyseCarve={() => void analyse()}
      analysing={analysing}
    />
  );
}
