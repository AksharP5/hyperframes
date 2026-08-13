/**
 * The preset shelf for the FX rack.
 *
 * Its own module rather than another block inside the section: the section is
 * already the largest file in the panel, and this surface is going to grow —
 * search, per-item descriptions and a preview of the chain each preset draws
 * are all queued behind it.
 */

import {
  audioFxPresetsByFamily,
  HF_AUDIO_FX_PRESET_FAMILIES,
  type HfAudioFxPresetFamily,
} from "@hyperframes/core/audio-fx-presets";

/**
 * Shelf names in the author's language, which is deliberately not the effect
 * registry's grouping. `group` says what an effect *is* (filter, dynamics);
 * somebody reaching for Telephone is shopping for what they *want*, and
 * Telephone is filters and saturation — nobody looks for it under either.
 */
const FAMILY_LABEL: Record<HfAudioFxPresetFamily, string> = {
  voice: "Voice",
  repair: "Fix",
  character: "Character",
  space: "Space",
};

export interface FxPresetMenuProps {
  onPick(id: string): void;
}

export function FxPresetMenu({ onPick }: FxPresetMenuProps) {
  return (
    <div className="hf-fx-preset-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5">
      {HF_AUDIO_FX_PRESET_FAMILIES.map((family) => (
        <div key={family} className="hf-fx-preset-group flex flex-wrap items-center gap-1">
          <span className="hf-fx-preset-group-label w-full font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
            {FAMILY_LABEL[family]}
          </span>
          {audioFxPresetsByFamily(family).map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="hf-fx-preset-item rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
              // The description says what it does; the count is doing real work
              // — it tells the author a preset IS a chain they can open and
              // edit, rather than an opaque setting they cannot follow.
              title={`${preset.description} (${preset.nodes.length} effect${
                preset.nodes.length === 1 ? "" : "s"
              })`}
              onClick={() => onPick(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
