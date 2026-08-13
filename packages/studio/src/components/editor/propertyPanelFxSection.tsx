/**
 * The FX section for an audio element: the chain, plus the voiceover carve.
 *
 * Carve is deliberately not an entry in the chain. It is a relationship between
 * two tracks — it analyses a voice and dips *this* bed where that voice sits —
 * so it gets its own block with a source picker, the way a sidechain control
 * lives on the track being processed. What it produces is an ordinary chain of
 * peaking filters, so it composes with whatever else is on the track.
 */

import { useCallback, useMemo, useState } from "react";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  HF_AUDIO_FX,
  mintAudioFxNodeId,
  type HfAudioFxChain,
  type HfAudioFxDef,
  type HfAudioFxGroup,
  type HfAudioFxNode,
  type HfAudioFxParam,
  type HfAudioFxParamValues,
} from "@hyperframes/core/audio-fx";
import { DEFAULT_CARVE, type HfCarveSettings } from "@hyperframes/core/audio-carve";
import { fxAutomationTarget } from "@hyperframes/core/audio-automation";
import { FxParams, FxParamRow } from "./propertyPanelFxControls.js";
// Shared with the timeline's lane labels: a band is named by its frequency in
// both places, and two formatters would drift.
import { formatHz } from "../../player/components/automationLaneData";

const GROUP_ORDER: HfAudioFxGroup[] = ["filter", "dynamics", "nonlinear", "time"];
const GROUP_LABEL: Record<HfAudioFxGroup, string> = {
  filter: "Filters",
  dynamics: "Dynamics",
  nonlinear: "Non-linear",
  time: "Time",
};

export interface AudioTrackOption {
  id: string;
  label: string;
}

interface FxNodeRowProps {
  node: HfAudioFxNode;
  index: number;
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
  onAutomateParam?(nodeId: string, paramKey: string): void;
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
  open: boolean;
  /** Last in the chain, so it cannot move further down. */
  last: boolean;
  disabled?: boolean;
  onToggleOpen(): void;
  onUpdate(index: number, patch: Partial<HfAudioFxNode>): void;
  onMove(index: number, delta: number): void;
  onRemove(index: number): void;
  onPreview(index: number, params: HfAudioFxParamValues): void;
}

/** Reorder arrow. Disabled at the end of the chain it would move past. */
function FxMoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="hf-fx-move px-1 font-mono text-[10px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-25"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
}

/** Name, bypass, reorder and remove for one effect. */
function FxNodeHeader({
  label,
  open,
  bypassed,
  first,
  last,
  disabled,
  onToggleOpen,
  onToggleBypass,
  onMove,
  onRemove,
}: {
  label: string;
  open: boolean;
  bypassed: boolean;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  onToggleOpen(): void;
  onToggleBypass(): void;
  onMove(delta: number): void;
  onRemove(): void;
}) {
  return (
    <div className="hf-fx-node-head flex min-h-7 items-center gap-1 px-1.5">
      <button
        type="button"
        className="hf-fx-node-name flex-1 truncate text-left text-[11px] font-semibold text-panel-text-1 hover:text-panel-text-0"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        {label}
      </button>
      <button
        type="button"
        className="hf-fx-bypass rounded-[3px] border border-panel-border-input px-1.5 py-0.5 font-mono text-[9px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
        aria-pressed={bypassed}
        title={bypassed ? "Enable" : "Bypass"}
        disabled={disabled}
        onClick={onToggleBypass}
      >
        {bypassed ? "Off" : "On"}
      </button>
      <FxMoveButton
        label="Move up"
        glyph="&uarr;"
        disabled={Boolean(disabled) || first}
        onClick={() => onMove(-1)}
      />
      <FxMoveButton
        label="Move down"
        glyph="&darr;"
        disabled={Boolean(disabled) || last}
        onClick={() => onMove(1)}
      />
      <button
        type="button"
        className="hf-fx-remove px-1 font-mono text-[11px] text-panel-text-4 hover:text-red-400 disabled:opacity-40"
        title="Remove"
        disabled={disabled}
        onClick={onRemove}
      >
        &times;
      </button>
    </div>
  );
}

/** What one effect inside the module is called: its own name, plus the band. */
function carveMemberName(node: HfAudioFxNode): string {
  const def = getAudioFxDef(node.type);
  const freq = node.params?.["frequency"];
  const label = def?.label ?? node.type;
  return typeof freq === "number" ? `${label} ${formatHz(freq)}` : label;
}

/** A parameter's value as the rack shows it: rounded to the step, with its unit. */
function formatParamValue(param: HfAudioFxParam, raw: number | string | undefined): string {
  if (param.kind !== "number" || typeof raw !== "number") return String(raw ?? "");
  const places = param.step >= 1 ? 0 : param.step >= 0.1 ? 1 : 2;
  return `${Number(raw.toFixed(places))}${param.unit ? ` ${param.unit}` : ""}`;
}

/**
 * Width to reserve for a parameter's value, in characters.
 *
 * Derived from what the parameter CAN read rather than what it currently reads, so
 * the column never moves: an automated value updates 30 times a second, and
 * `-1 dB` is two characters narrower than `-3.2 dB`, which was enough to shunt
 * everything after it sideways on every frame. `ch` is exact here because the
 * readouts are monospace and already `tabular-nums`.
 */
function paramValueWidthCh(param: HfAudioFxParam): number {
  if (param.kind === "enum") {
    return Math.max(1, ...param.options.map((option) => option.value.length));
  }
  const places = param.step >= 1 ? 0 : param.step >= 0.1 ? 1 : 2;
  const digits = Math.max(
    String(Math.floor(Math.abs(param.min))).length,
    String(Math.floor(Math.abs(param.max))).length,
  );
  const sign = param.min < 0 ? 1 : 0;
  const decimals = places > 0 ? places + 1 : 0;
  const unit = param.unit ? param.unit.length + 1 : 0;
  return sign + digits + decimals + unit;
}

/** One member of the module: what it is, and what every knob is set to. */
function FxCarveMember({
  node,
  automatedTargets,
  liveAutomationValues,
}: {
  node: HfAudioFxNode;
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
}) {
  const def = getAudioFxDef(node.type);
  if (!def) return null;
  const params = node.params ?? defaultAudioFxParams(node.type);
  return (
    <div className="hf-fx-carve-member flex flex-col gap-0.5 py-1 pl-3 pr-1.5">
      <span className="hf-fx-carve-member-name truncate font-mono text-[9px] text-panel-text-1">
        {carveMemberName(node)}
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {def.params.map((param) => {
          const target = node.id ? fxAutomationTarget(node.id, param.key) : null;
          const automated = Boolean(target && automatedTargets?.has(target));
          // The envelope's value at the playhead when there is one, which is what
          // the audio is using; the stored number is only the seed behind it.
          const live = target ? liveAutomationValues?.get(target) : undefined;
          const driven = automated && live !== undefined;
          const value = formatParamValue(param, driven ? live : params[param.key]);
          return (
            <span
              key={param.key}
              className="flex items-baseline gap-1 font-mono text-[9px] text-panel-text-4"
              {...(automated ? { "data-automated": "" } : {})}
              {...(driven ? { "data-automation-live": "" } : {})}
            >
              <span className="text-panel-text-4">{param.label}</span>
              <span
                className="tabular-nums text-panel-text-1"
                style={{ minWidth: `${paramValueWidthCh(param)}ch` }}
              >
                {value}
              </span>
              {/* The lane is where an automated value comes from, and where it is
                  edited — saying so is the difference between a stale readout and
                  a pointer to the thing that owns it. */}
              {automated ? <span className="text-[#3CE6AC]">A</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The carve, as one module in the rack.
 *
 * A carve is one thing the author switched on; the peaking filters and the level
 * stage are how it is built. Listed individually they read as hand-built effects —
 * removable one at a time, reorderable, each with knobs the next strength change
 * silently overwrites. So the rack shows the unit, and the unit owns everything
 * that means anything for it: which voice it listens to, how hard it works,
 * whether it follows that voice, and what the analysis made of it.
 *
 * The controls used to sit in their own block under the rack, which read as a
 * second, unrelated feature that happened to produce effects somewhere else. One
 * card, controls above the analysis they drive, is the same thing said once.
 *
 * Grouped is not hidden. Opening it lists every effect inside with all of its
 * settings, because an author has to be able to see where the analysis landed — as
 * readouts rather than controls, since strength is what sets them and a knob here
 * would be overwritten by the next adjustment.
 */
function FxCarveModule({
  nodes,
  carve,
  sourceOptions,
  automatedTargets,
  liveAutomationValues,
  open,
  disabled,
  analysing,
  onToggleOpen,
  onCarveChange,
  onCarvePreview,
}: {
  nodes: HfAudioFxNode[];
  carve: HfCarveSettings;
  sourceOptions: AudioTrackOption[];
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
  open: boolean;
  disabled?: boolean;
  analysing?: boolean;
  onToggleOpen(): void;
  onCarveChange(carve: HfCarveSettings): void;
  onCarvePreview(carve: HfCarveSettings): void;
}) {
  const bands = nodes.filter((n) => n.type === "peaking").length;
  const hasLevel = nodes.some((n) => n.type === "gain");
  const on = carve.enabled;
  /**
   * The only track this bed could be listening to, when there is exactly one.
   *
   * A picker with one entry is a question with one answer: it asks the author to
   * confirm something already decided. So the voice reads out instead.
   *
   * Not when the stored source is some OTHER track, though — a name that no longer
   * classifies as a voice, or a track since renamed. Reading out the one remaining
   * candidate there would quietly claim the carve listens to something it does not,
   * so the picker comes back and shows the mismatch.
   */
  const soleVoice =
    sourceOptions.length === 1 &&
    (carve.sources.length === 0 ||
      (carve.sources.length === 1 && carve.sources[0] === sourceOptions[0]?.id))
      ? sourceOptions[0]
      : null;
  // What the module is worth right now, in the head, so a collapsed card still
  // says whether it is doing anything: the analysis it produced, or why not.
  const summary = !on
    ? "off"
    : analysing
      ? "analysing…"
      : bands > 0
        ? [
            `${bands} band${bands === 1 ? "" : "s"}`,
            ...(hasLevel ? ["level"] : []),
            // Worth saying when it is more than one: the cuts follow whoever is
            // speaking, and that is not obvious from a band count.
            ...(carve.sources.length > 1 ? [`${carve.sources.length} voices`] : []),
          ].join(" + ")
        : carve.sources.length > 0
          ? "no analysis yet"
          : "pick a voice";
  return (
    <div
      className={`hf-fx-node hf-fx-carve-module hf-fx-carve rounded-[4px] border border-panel-border-input${
        on ? "" : " opacity-50"
      }`}
      data-fx-node="carve"
      data-carve-enabled={on ? "" : undefined}
    >
      <div className="hf-fx-node-head flex min-h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          className="hf-fx-node-name min-w-0 flex-1 truncate text-left text-[11px] font-semibold text-panel-text-1 hover:text-panel-text-0"
          aria-expanded={open}
          onClick={onToggleOpen}
        >
          Voiceover carve
        </button>
        <span className="hf-fx-carve-summary shrink-0 font-mono text-[9px] text-panel-text-4">
          {summary}
        </span>
        {/* One switch, not a bypass and a delete. Off drops the effects and the
            envelopes it wrote, and is remembered — otherwise the default would
            re-apply the carve the next time this clip was selected. */}
        <button
          type="button"
          className="hf-fx-bypass hf-fx-carve-toggle rounded-[3px] border border-panel-border-input px-1.5 py-0.5 font-mono text-[9px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
          aria-pressed={on}
          title={on ? "Switch the carve off" : "Switch the carve on"}
          disabled={disabled}
          onClick={() => onCarveChange({ ...carve, enabled: !on })}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      {open && on ? (
        <div className="hf-fx-carve-body border-t border-panel-border-input">
          <div className="hf-fx-carve-controls space-y-0.5 px-1.5 py-1.5">
            <div className="hf-fx-row flex min-h-6 items-center gap-2">
              <span className="hf-fx-label w-[86px] flex-shrink-0 truncate text-[10px] text-panel-text-4">
                Listen to
              </span>
              {soleVoice ? (
                <span
                  className="hf-fx-carve-source min-w-0 flex-1 truncate font-mono text-[10px] text-panel-text-1"
                  data-carve-source={soleVoice.id}
                >
                  {soleVoice.label}
                </span>
              ) : (
                /* Every voice, not one of them. A bed usually runs under a whole
                   sequence — a narrator, an answer, a second presenter — and they are
                   analysed together, so the cuts follow whoever is speaking. Which
                   makes this a set of things to include, not a choice between them. */
                <div className="hf-fx-carve-sources flex min-w-0 flex-1 flex-wrap gap-x-2.5 gap-y-0.5">
                  {sourceOptions.map((o) => (
                    <label
                      key={o.id}
                      className="flex min-w-0 items-center gap-1 font-mono text-[9px] text-panel-text-1"
                      title={`Make room for ${o.label}`}
                    >
                      <input
                        type="checkbox"
                        className="hf-fx-carve-source h-2.5 w-2.5 accent-panel-accent"
                        data-carve-source={o.id}
                        checked={carve.sources.includes(o.id)}
                        disabled={disabled}
                        onChange={(e) =>
                          onCarveChange({
                            ...carve,
                            sources: e.target.checked
                              ? [...carve.sources, o.id]
                              : carve.sources.filter((id) => id !== o.id),
                          })
                        }
                      />
                      <span className="truncate">{o.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {/* One knob for the whole effect. Depth, band count, width, the
                intelligibility weighting and both level-match numbers move together
                anyway — a gentle carve is shallow in few bands with little ducking, a
                hard one is deeper in more with more — so the panel sets the strength
                and `carveProfile` derives the six numbers the analysis works in. */}
            <FxParamRow
              param={{
                kind: "number",
                key: "strength",
                label: "Strength",
                unit: "",
                min: 0,
                max: 1,
                step: 0.05,
                default: DEFAULT_CARVE.strength,
                hint: "How hard to carve: deeper cuts, in more bands, and more room made by dropping the bed's level under the voice. At 0 it carves frequencies only. Moving this re-runs the analysis on what is already here.",
              }}
              value={carve.strength}
              disabled={disabled || carve.sources.length === 0}
              onChange={(_k, v) => onCarvePreview({ ...carve, strength: Number(v) })}
              onCommit={(_k, v) => onCarveChange({ ...carve, strength: Number(v) })}
            />
          </div>
          {/* What the analysis made of all that. Divided rather than boxed: these
              are parts of one module, and a border around each would read as the
              separate effects this replaced. */}
          {/* While the analysis runs, the previous filters are gone rather than
              stale. Every number in that list is about to be replaced — a strength
              change re-derives all of them — so leaving them up reads as the
              settings that are in force when they are already history, and the one
              honest thing to say is that the work is happening. */}
          {analysing ? (
            <p className="hf-fx-carve-working flex items-center justify-center gap-1.5 border-t border-panel-border-input py-2 text-[10px] text-panel-text-4">
              <svg
                className="hf-fx-carve-spinner h-3 w-3 animate-spin motion-reduce:animate-none"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Analysing…
            </p>
          ) : nodes.length > 0 ? (
            <div className="hf-fx-carve-members divide-y divide-panel-border-input/60 border-t border-panel-border-input">
              <div className="hf-fx-carve-members-label px-1.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
                analysed
              </div>
              {nodes.map((node, i) => (
                <FxCarveMember
                  key={node.id ?? `${node.type}-${i}`}
                  node={node}
                  automatedTargets={automatedTargets}
                  liveAutomationValues={liveAutomationValues}
                />
              ))}
            </div>
          ) : (
            <p className="hf-fx-carve-working border-t border-panel-border-input py-1.5 text-center text-[10px] text-panel-text-4">
              {carve.sources.length > 0
                ? "Nothing analysed yet."
                : "Pick the voices this bed should make room for."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Which of an effect's knobs already have a lane.
 *
 * A lane addresses a node by id, so a node the panel has not yet given one
 * cannot be automated at all. Adding an effect mints the id, so this only
 * affects chains written before ids existed.
 */
function automatedKeysOf(
  node: HfAudioFxNode,
  params: readonly { key: string }[],
  automatedTargets: ReadonlySet<string> | undefined,
): Set<string> {
  if (!node.id || !automatedTargets) return new Set();
  const nodeId = node.id;
  return new Set(
    params.filter((p) => automatedTargets.has(fxAutomationTarget(nodeId, p.key))).map((p) => p.key),
  );
}

/** An open effect's knobs, with whatever automation surface applies to them. */
function FxNodeParams({
  node,
  def,
  index,
  disabled,
  automatedTargets,
  liveAutomationValues,
  onUpdate,
  onPreview,
  onAutomateParam,
  onRemoveParamAutomation,
}: {
  node: HfAudioFxNode;
  def: HfAudioFxDef;
  index: number;
  disabled: boolean;
  automatedTargets?: ReadonlySet<string>;
  liveAutomationValues?: ReadonlyMap<string, number>;
  onUpdate(index: number, patch: Partial<HfAudioFxNode>): void;
  onPreview(index: number, params: HfAudioFxParamValues): void;
  onAutomateParam?(nodeId: string, paramKey: string): void;
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
}) {
  const nodeId = node.id;
  // Lanes address a node by id; the controls know their own parameter keys. This
  // is the one place that translation belongs.
  const liveValues = ((): Map<string, number> | undefined => {
    if (!nodeId || !liveAutomationValues?.size) return undefined;
    const byKey = new Map<string, number>();
    for (const param of def.params) {
      const live = liveAutomationValues.get(fxAutomationTarget(nodeId, param.key));
      if (live !== undefined) byKey.set(param.key, live);
    }
    return byKey;
  })();
  return (
    <FxParams
      def={def}
      params={node.params ?? defaultAudioFxParams(node.type)}
      liveValues={liveValues}
      disabled={disabled}
      onChange={(params: HfAudioFxParamValues) => onPreview(index, params)}
      onCommit={(params: HfAudioFxParamValues) => onUpdate(index, { params })}
      automatedKeys={automatedKeysOf(node, def.params, automatedTargets)}
      onAutomate={nodeId && onAutomateParam ? (key) => onAutomateParam(nodeId, key) : undefined}
      onRemoveAutomation={
        nodeId && onRemoveParamAutomation
          ? (key) => onRemoveParamAutomation(nodeId, key)
          : undefined
      }
    />
  );
}

/** One effect in the chain: its header controls, and its knobs when open. */
function FxNodeRow({
  node,
  index,
  automatedTargets,
  liveAutomationValues,
  onAutomateParam,
  onRemoveParamAutomation,
  open,
  last,
  disabled,
  onToggleOpen,
  onUpdate,
  onMove,
  onRemove,
  onPreview,
}: FxNodeRowProps) {
  const def = getAudioFxDef(node.type);
  if (!def) return null;
  const bypassed = node.enabled === false;
  return (
    <div
      className={`hf-fx-node rounded-[4px] border border-panel-border-input${bypassed ? " opacity-50" : ""}`}
      data-fx-node={node.type}
    >
      <FxNodeHeader
        label={def.label}
        open={open}
        bypassed={bypassed}
        first={index === 0}
        last={last}
        disabled={disabled}
        onToggleOpen={onToggleOpen}
        onToggleBypass={() => onUpdate(index, { enabled: bypassed })}
        onMove={(delta) => onMove(index, delta)}
        onRemove={() => onRemove(index)}
      />
      {open ? (
        <FxNodeParams
          node={node}
          def={def}
          index={index}
          disabled={Boolean(disabled) || bypassed}
          automatedTargets={automatedTargets}
          liveAutomationValues={liveAutomationValues}
          onUpdate={onUpdate}
          onPreview={onPreview}
          onAutomateParam={onAutomateParam}
          onRemoveParamAutomation={onRemoveParamAutomation}
        />
      ) : null}
    </div>
  );
}

export interface FxSectionProps {
  chain: HfAudioFxChain;
  /** Targets this track already automates, as `fx.<nodeId>.<param>` strings. */
  automatedTargets?: ReadonlySet<string>;
  /**
   * What each automated target is worth at the playhead, by the same key.
   *
   * An automated parameter's stored number is only the seed the lane replaced, so
   * a rack that shows it stands still while the carve is audibly working. Absent,
   * or missing a key, means there is no playhead over this clip and the stored
   * value is the honest one.
   */
  liveAutomationValues?: ReadonlyMap<string, number>;
  /** Add a lane for one effect parameter, seeded at its current value. */
  onAutomateParam?(nodeId: string, paramKey: string): void;
  /** Delete one effect parameter's lane. */
  onRemoveParamAutomation?(nodeId: string, paramKey: string): void;
  /** Delete every lane belonging to a node that is being removed. */
  onRemoveNodeAutomation?(nodeId: string): void;
  /** Structural edits and gesture-end writes; this is the one that persists. */
  onChainChange(chain: HfAudioFxChain): void;
  /** Continuous updates while a control is being dragged. */
  onChainPreview?(chain: HfAudioFxChain): void;
  carve: HfCarveSettings | null;
  /** Gesture-end write; this is the one that persists. */
  onCarveChange(carve: HfCarveSettings | null): void;
  /** Continuous updates while a carve slider is dragged. Without this every
   *  pointermove patched the source file and resynced the selection. */
  onCarvePreview?(carve: HfCarveSettings): void;
  /**
   * Set when another track's carve listens to this one, naming it. The carve block
   * is then not offered here at all: this track is the voice, not the bed.
   */
  carvedAgainstBy?: string | null;
  /** Other audio elements that could act as the carve source. */
  sourceOptions: AudioTrackOption[];
  analysing?: boolean;
  disabled?: boolean;
}

export function FxSection({
  chain,
  automatedTargets,
  liveAutomationValues,
  onAutomateParam,
  onRemoveParamAutomation,
  onRemoveNodeAutomation,
  onChainChange,
  onChainPreview,
  carve,
  carvedAgainstBy,
  onCarveChange,
  onCarvePreview,
  sourceOptions,
  analysing,
  disabled,
}: FxSectionProps) {
  // Falls back to the persisting write when no preview handler is supplied, which
  // keeps the control working rather than going dead.
  const previewCarve = onCarvePreview ?? onCarveChange;

  // Nothing to carve against means nothing to show — see the block below.
  // Not offered on the voice another track is already carving against — that
  // track is the far end of someone else's relationship, and a carve of its own
  // could only name a source it must not.
  const showCarve = !carvedAgainstBy && (sourceOptions.length > 0 || carve !== null);

  const [adding, setAdding] = useState(false);
  const [openNode, setOpenNode] = useState<number | null>(0);

  const grouped = useMemo(
    () => GROUP_ORDER.map((g) => ({ group: g, defs: HF_AUDIO_FX.filter((d) => d.group === g) })),
    [],
  );

  const mutate = useCallback(
    (nodes: HfAudioFxNode[]) => onChainChange({ ...chain, nodes }),
    [chain, onChainChange],
  );

  // Dragging a knob previews without persisting; releasing it commits once.
  const previewNode = useCallback(
    (index: number, params: HfAudioFxParamValues) =>
      onChainPreview?.({
        ...chain,
        nodes: chain.nodes.map((n, i) => (i === index ? { ...n, params } : n)),
      }),
    [chain, onChainPreview],
  );

  const addEffect = useCallback(
    (type: string) => {
      mutate([
        ...chain.nodes,
        { type, id: mintAudioFxNodeId(chain), enabled: true, params: defaultAudioFxParams(type) },
      ]);
      setOpenNode(chain.nodes.length);
      setAdding(false);
    },
    [chain, mutate],
  );

  const updateNode = useCallback(
    (index: number, patch: Partial<HfAudioFxNode>) =>
      mutate(chain.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n))),
    [chain.nodes, mutate],
  );

  const removeNode = useCallback(
    (index: number) => {
      // The node's lanes go with it. `resolveAutomation` only hides an orphan at
      // read time; left in the attribute, and with ids minted lowest-free, the
      // next effect added takes the same id and inherits the dead envelope —
      // arriving with its control disabled and "Automated" without the author
      // ever automating it, and baked into the render.
      const removedId = chain.nodes[index]?.id;
      if (removedId) onRemoveNodeAutomation?.(removedId);
      mutate(chain.nodes.filter((_, i) => i !== index));
      setOpenNode(null);
    },
    [chain.nodes, mutate, onRemoveNodeAutomation],
  );

  // Open by default: the module is the carve's whole control surface now, and a
  // collapsed card would hide the knob the author came here for.
  const [carveOpen, setCarveOpen] = useState(true);
  const carveNodes = useMemo(() => chain.nodes.filter((n) => n.fromCarve), [chain.nodes]);
  /** Everything the author added, with the chain index every edit addresses. */
  const handBuilt = useMemo(
    () => chain.nodes.map((node, i) => ({ node, i })).filter(({ node }) => !node.fromCarve),
    [chain.nodes],
  );

  const moveNode = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= chain.nodes.length) return;
      const next = [...chain.nodes];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      mutate(next);
      setOpenNode(target);
    },
    [chain.nodes, mutate],
  );

  return (
    <div className="hf-fx-section space-y-2">
      <div className="hf-fx-chain space-y-1">
        {/* Carve leads the rack, which is also where its effects sit in the signal
            path — corrective work before anything the author added. Present
            whenever there is a voice for it to listen to, rather than appearing
            only once it has already produced something: a control that materialises
            after the fact cannot be the thing you reach for to start. */}
        {showCarve ? (
          <FxCarveModule
            nodes={carveNodes}
            carve={carve ?? { ...DEFAULT_CARVE }}
            sourceOptions={sourceOptions}
            automatedTargets={automatedTargets}
            liveAutomationValues={liveAutomationValues}
            open={carveOpen}
            disabled={disabled}
            analysing={analysing}
            onToggleOpen={() => setCarveOpen((was) => !was)}
            onCarveChange={onCarveChange}
            onCarvePreview={previewCarve}
          />
        ) : null}
        {handBuilt.length === 0 ? (
          <p className="hf-fx-empty py-1 text-[11px] text-panel-text-4">
            {showCarve ? "No other effects on this track." : "No effects on this track."}
          </p>
        ) : (
          handBuilt.map(({ node, i }) => {
            return (
              <FxNodeRow
                key={`${node.type}-${i}`}
                node={node}
                index={i}
                automatedTargets={automatedTargets}
                liveAutomationValues={liveAutomationValues}
                onAutomateParam={onAutomateParam}
                onRemoveParamAutomation={onRemoveParamAutomation}
                open={openNode === i}
                last={i === chain.nodes.length - 1}
                disabled={disabled}
                onToggleOpen={() => setOpenNode(openNode === i ? null : i)}
                onUpdate={updateNode}
                onMove={moveNode}
                onRemove={removeNode}
                onPreview={previewNode}
              />
            );
          })
        )}
      </div>

      {adding ? (
        <div className="hf-fx-add-menu space-y-1.5 rounded-[4px] border border-panel-border-input p-1.5">
          {grouped.map(({ group, defs }) => (
            <div key={group} className="hf-fx-add-group flex flex-wrap items-center gap-1">
              <span className="hf-fx-add-group-label w-full font-mono text-[9px] uppercase tracking-wide text-panel-text-4">
                {GROUP_LABEL[group]}
              </span>
              {defs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="hf-fx-add-item rounded-[3px] bg-panel-surface px-1.5 py-0.5 text-[10px] text-panel-text-1 hover:text-panel-text-0"
                  title={d.description}
                  onClick={() => addEffect(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="hf-fx-add w-full rounded-[4px] border border-dashed border-panel-border-input py-1 text-[11px] text-panel-text-4 hover:text-panel-text-0 disabled:opacity-40"
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          Add effect
        </button>
      )}
    </div>
  );
}
