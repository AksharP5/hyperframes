import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { normalizeErrorMessage } from "../utils/errorMessage.js";

// ---------------------------------------------------------------------------
// Config directory: ~/.hyperframes/
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".hyperframes");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Install-state file: ~/.hyperframes/install-state.json
//
// A separate FILE, but deliberately the same DIRECTORY as config.json, so
// `rm -rf ~/.hyperframes` really is a full reset. It previously lived in
// ~/.local/state/hyperframes/ specifically to survive that delete; review
// rejected that ("if someone is deleting their hyperframes config it should
// wipe all hyperframes state — I'm not sure we should try and persist state
// elsewhere to get around this"), and the measurement agreed: the churn this
// actually defends against is not users running `rm -rf`.
//
// The threat it does defend against is config.json itself. That file is hot
// and wide — ~20 fields rewritten on every command and every render — and
// readConfig recovers from ANY parse/permission/IO failure by minting a fresh
// identity. Splitting these two facts into their own file decouples them from
// that churn: no shared schema to migrate on upgrade, and one write at first
// mint instead of one per command.
//
// It carries exactly three facts, and no telemetry identity — no anonymousId,
// no counters, nothing emitted that links the old install to the new one:
//
//   1. `markerAt` — "a hyperframes install existed on this machine". Now that
//      it shares CONFIG_DIR, `predecessorFound` measures the churn we care
//      about (config.json lost, install-state survived => corruption/re-mint)
//      rather than deliberate directory deletion, which takes both.
//   2. `deParallelRouterTrialFired` — the DE parallel-router circuit
//      breaker's tripped state, so a config re-mint does not re-enrol an
//      install into an experimental path that already FAILED on this machine.
//   3. `bucketSeed` — the canary bucketing unit, so a re-mint does not
//      reshuffle cohorts mid-rollout. Never transmitted; only the resulting
//      true/false assignments are. Sharing CONFIG_DIR is what keeps it from
//      being a persistent identifier that outlives the user's reset.
//
// Removal path: delete ~/.hyperframes (or just this file). `hyperframes
// telemetry status` prints its exact location.
// ---------------------------------------------------------------------------

const STATE_FILE = join(CONFIG_DIR, "install-state.json");

// Pre-move location. Read once, migrated, then deleted — an install that
// wrote state under the old scheme keeps its tripped breaker instead of
// silently re-enrolling, and no file is left behind outside CONFIG_DIR.
const LEGACY_STATE_FILE = join(homedir(), ".local", "state", "hyperframes", "install-state.json");

interface InstallState {
  /** ISO timestamp of when the marker was first written. */
  markerAt: string;
  /** Rolled-over circuit-breaker state — see HyperframesConfig's field. */
  deParallelRouterTrialFired?: boolean;
  /**
   * The canary bucketing seed — see HyperframesConfig's field. Write-once
   * within this config dir: the first install's seed wins forever, so a
   * config.json re-mint re-rolls the telemetry id but NOT the canary cohorts.
   * Deleting ~/.hyperframes takes the seed with it, by design.
   */
  bucketSeed?: string;
}

/**
 * Why there is no usable state: the file isn't there, or it is but couldn't be
 * read/parsed. Distinguished because they mean opposite things for churn
 * measurement — "absent" is a genuinely new machine, "corrupt" is a machine we
 * already knew whose record we lost. Collapsing them into one `null` reported
 * every corruption as a fresh install and biased `predecessorFound` low.
 */
type InstallStateMiss = "absent" | "corrupt";

/**
 * Parse one state file.
 *
 * A malformed `markerAt` no longer discards the record. `markerAt` is
 * regenerable — it is only a timestamp — while `bucketSeed` is not: losing it
 * silently re-rolls the install's canary cohort. So a partial corruption that
 * leaves a usable seed keeps the seed and restamps the marker.
 */
function salvageInstallState(parsed: Partial<InstallState>): InstallState | InstallStateMiss {
  const markerAt = typeof parsed.markerAt === "string" ? parsed.markerAt : undefined;
  const bucketSeed = parseNonEmptyString(parsed.bucketSeed);
  // Nothing salvageable in the record at all — treat as corrupt rather than
  // inventing a marker, so the miss is still counted as "we knew this machine"
  // instead of masquerading as a fresh install.
  if (markerAt === undefined && bucketSeed === undefined) return "corrupt";
  return {
    markerAt: markerAt ?? new Date().toISOString(),
    deParallelRouterTrialFired: parsed.deParallelRouterTrialFired === true ? true : undefined,
    bucketSeed,
  };
}

function parseInstallState(file: string): InstallState | InstallStateMiss {
  if (!existsSync(file)) return "absent";
  try {
    return salvageInstallState(JSON.parse(readFileSync(file, "utf-8")) as Partial<InstallState>);
  } catch {
    return "corrupt";
  }
}

// Once per process: the backfill runs on every readConfig until it lands, and
// a read-only home directory would otherwise print on every single command.
let seedBackfillWarned = false;

/**
 * The seed backfill could not be persisted, so this install will mint a
 * different seed next invocation and silently churn its canary cohort. Rare
 * (unwritable ~/.hyperframes) but invisible without this, and it makes the
 * "backfilled once" contract in the field's docstring false.
 */
function warnSeedBackfillFailed(error: string | undefined): void {
  if (seedBackfillWarned) return;
  seedBackfillWarned = true;
  console.warn(
    `[hyperframes] Could not persist telemetry config${error ? `: ${error}` : ""}. ` +
      "Canary cohort assignment will not be stable across runs.",
  );
}

/**
 * One-time backfill for configs predating the bucket seed: prefer the seed a
 * previous install recorded, else mint. Mutates `config` in place.
 *
 * Persisting is the whole point — an unpersisted seed re-rolls next process,
 * silently churning this install's cohort on every invocation. `~/.hyperframes`
 * being unwritable (root-owned after a sudo mishap, read-only mount, disk full)
 * is exactly when that happens, so it says so once rather than failing
 * invisibly.
 */
function backfillBucketSeed(config: HyperframesConfig): void {
  const recorded = readInstallState();
  config.bucketSeed = (isInstallState(recorded) ? recorded.bucketSeed : undefined) ?? randomUUID();
  const write = writeConfigWithResult(config);
  if (!write.ok) warnSeedBackfillFailed(write.error);
}

/** Narrow the parse result to a usable record. */
function isInstallState(value: InstallState | InstallStateMiss): value is InstallState {
  return typeof value !== "string";
}

/**
 * Read the install-state file, adopting the pre-move copy if this machine
 * still has one.
 *
 * Migration is one-way and best-effort: the current location always wins (a
 * stale legacy file must never resurrect a breaker the user has since
 * cleared), and failing to delete the legacy copy is not an error — it is
 * re-read harmlessly next time.
 */
function readInstallState(): InstallState | InstallStateMiss {
  const current = parseInstallState(STATE_FILE);
  if (isInstallState(current)) {
    removeLegacyStateFile();
    return current;
  }
  const legacy = parseInstallState(LEGACY_STATE_FILE);
  if (!isInstallState(legacy)) {
    // Corruption at EITHER location still means this machine had an install.
    return current === "corrupt" || legacy === "corrupt" ? "corrupt" : "absent";
  }
  try {
    writeInstallState(legacy);
    removeLegacyStateFile();
  } catch {
    // Keep the legacy copy; the value is still returned below either way.
  }
  return legacy;
}

function removeLegacyStateFile(): void {
  try {
    if (existsSync(LEGACY_STATE_FILE)) rmSync(LEGACY_STATE_FILE, { force: true });
  } catch {
    // Best-effort cleanup — never break the CLI over a leftover file.
  }
}

// Sync bookkeeping, so the existsSync+read doesn't run on every writeConfig:
// `stateMarkerSynced` = the marker is known present; `stateFiredSynced` = the
// state file is known to already carry fired=true.
let stateMarkerSynced = false;
let stateFiredSynced = false;

/** Test-only: reset the sync memo (module state leaks across vitest cases). */
export function __resetInstallStateSyncForTests(): void {
  stateMarkerSynced = false;
  stateFiredSynced = false;
}

/**
 * Atomic for the same reason writeConfig is: a torn read must never exist,
 * since a corrupted state file silently reads as absent.
 */
function writeInstallState(next: InstallState): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmpFile = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmpFile, STATE_FILE);
}

/**
 * Bring the install-state file up to date with this config write: ensure the
 * marker exists, and mirror a tripped breaker. Called from `writeConfig` so
 * no breaker write site can forget it. Never throws — same contract as the
 * rest of this file, telemetry must not break the CLI.
 */
function sameInstallState(a: InstallState, b: InstallState): boolean {
  return (
    a.deParallelRouterTrialFired === b.deParallelRouterTrialFired && a.bucketSeed === b.bucketSeed
  );
}

/** Latching: once tripped (by any install in this config dir), stays tripped. */
function latchedFired(state: InstallState | null, config: HyperframesConfig): true | undefined {
  return (
    state?.deParallelRouterTrialFired === true ||
    config.deParallelRouterTrialFired === true ||
    undefined
  );
}

/** What the state file should say after this config write; null = already correct. */
function nextInstallState(
  state: InstallState | null,
  config: HyperframesConfig,
): InstallState | null {
  const next: InstallState = {
    markerAt: state?.markerAt ?? new Date().toISOString(),
    deParallelRouterTrialFired: latchedFired(state, config),
    // Write-once: an existing seed always wins, so cohorts stay
    // anchored to the FIRST install in this config dir, not the latest one.
    bucketSeed: state?.bucketSeed ?? config.bucketSeed,
  };
  if (state !== null && sameInstallState(state, next)) return null;
  return next;
}

function syncInstallState(config: HyperframesConfig): void {
  const wantFired = config.deParallelRouterTrialFired === true;
  if (stateMarkerSynced && (stateFiredSynced || !wantFired)) return;
  try {
    const read = readInstallState();
    const state = isInstallState(read) ? read : null;
    const next = nextInstallState(state, config);
    if (next !== null) writeInstallState(next);
    stateMarkerSynced = true;
    stateFiredSynced = wantFired || state?.deParallelRouterTrialFired === true;
  } catch {
    // Leave the memo unset so a later write retries.
  }
}

/**
 * Build a brand-new config for an install with no (readable) config file,
 * consulting the install-state file for what a previous install on this
 * machine left behind.
 */
function mintConfig(): HyperframesConfig {
  const read = readInstallState();
  const state = isInstallState(read) ? read : null;
  return {
    ...DEFAULT_CONFIG,
    anonymousId: randomUUID(),
    // A corrupt record still means this machine had an install — reporting it
    // as `false` would count a partial disk write as a brand-new machine and
    // understate recoverable churn, which is the one thing this field exists
    // to measure. `undefined` on configs minted before the field existed.
    predecessorFound: state !== null || read === "corrupt",
    stateFileCorrupt: read === "corrupt" ? true : undefined,
    // The rollover itself: a breaker tripped by a previous install on this
    // machine stays tripped for the new one, and the canary bucketing seed is
    // inherited so cohorts hold across a config.json re-mint.
    deParallelRouterTrialFired: state?.deParallelRouterTrialFired === true ? true : undefined,
    bucketSeed: state?.bucketSeed ?? randomUUID(),
  };
}

export interface HyperframesConfig {
  /** Whether anonymous telemetry is enabled (default: true in production) */
  telemetryEnabled: boolean;
  /** Stable anonymous identifier — no PII, just a random UUID */
  anonymousId: string;
  /** Whether the first-run telemetry notice has been shown */
  telemetryNoticeShown: boolean;
  /** Total CLI command invocations (for engagement prompts) */
  commandCount: number;
  /** Total successful renders (for feedback prompt gating) */
  renderSuccessCount: number;
  /** The renderSuccessCount at which feedback was last shown */
  lastFeedbackPromptAt: number;
  /** ISO timestamp of the last npm registry version check */
  lastUpdateCheck?: string;
  /** Latest version found on npm */
  latestVersion?: string;
  /** Throttle for the non-TTY stale-project-pin notice (ms epoch). */
  lastStalePinNoticeAt?: number;
  /**
   * Auto-update marker. Set when a background install is spawned so a
   * subsequent run can skip re-triggering it. Cleared once
   * `completedUpdate` captures the outcome.
   */
  pendingUpdate?: {
    /** Version being installed. */
    version: string;
    /** Install command being run, for debug logging. */
    command: string;
    /** ISO timestamp of when the background install was launched. */
    startedAt: string;
  };
  /**
   * Outcome of the last completed auto-update, written by the detached
   * installer. Surfaced once in the next invocation and then cleared.
   */
  completedUpdate?: {
    version: string;
    /** Whether the install succeeded. */
    ok: boolean;
    /** ISO timestamp of when the installer finished. */
    finishedAt: string;
    /** Non-empty when `ok === false` — the installer's stderr tail. */
    error?: string;
    /** True after the result has been surfaced once to the user. */
    reported?: boolean;
  };
  /** ISO timestamp of the last `skills check` freshness check (24h cache). */
  lastSkillsCheck?: string;
  /** Whether installed skills were stale at the last check. */
  skillsUpdateAvailable?: boolean;
  /** How many installed skills were outdated at the last check. */
  skillsOutdatedCount?: number;
  /** How many skills were missing (not installed) at the last check. */
  skillsMissingCount?: number;
  /** How many installed skills were flagged removed-upstream at the last check. */
  skillsRemovedCount?: number;
  /**
   * True once the DE parallel-router experiment ("HF_DE_PARALLEL_ROUTER")
   * has actually FAILED (its self-verify/generic-failure safety net fired —
   * "reverted", not merely "routed") on a render from this install. The CLI
   * enables the experiment for free on EVERY eligible render from a fresh
   * install — not just once — to maximize real-traffic router telemetry
   * (mostly successful "routed" outcomes) without requiring anyone to
   * manually opt in via env var; only a real failure turns it off, and only
   * for this install going forward. See `renderLocal`'s
   * `maybeEnableDeParallelRouterTrial`/`maybeConsumeDeParallelRouterTrial`.
   */
  deParallelRouterTrialFired?: boolean;
  /**
   * Count of engaged (routed or reverted) trial renders so far — the
   * backstop that caps exposure even absent an actual failure. See
   * `DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS` in `render.ts`.
   */
  deParallelRouterTrialRenderCount?: number;
  /**
   * Whether a previous install's state marker existed on this machine when
   * this config was minted. Attached to telemetry so the fraction of fresh
   * installs that are RECOVERABLE churn (config.json re-minted, install-state
   * survived) is
   * measurable directly. `undefined` on configs minted before this field
   * existed — a different fact from `false` (minted fresh, no predecessor).
   */
  predecessorFound?: boolean;
  /**
   * The install-state file existed but could not be read. Separates "we lost
   * this machine's record" from "genuinely new machine" in the churn split —
   * without it a partial disk write is indistinguishable from a fresh install.
   * Absent (not false) in the normal case, so it costs nothing on the wire.
   */
  stateFileCorrupt?: boolean;
  /**
   * The unit canary percentages bucket on — deliberately NOT the anonymousId.
   * A fresh random UUID, mirrored write-once into the install-state file and
   * inherited at mint, so a config.json RE-MINT re-rolls the telemetry id but
   * keeps this install's canary cohorts: no cumulative-exposure drift from
   * corruption, and before/after comparisons survive one.
   *
   * A re-mint is the churn that actually happens — config.json is rewritten on
   * every command and every render, and readConfig recovers from any
   * parse/permission/IO failure by minting fresh. Deleting ~/.hyperframes
   * deliberately does NOT survive: install-state lives in that same directory
   * precisely so the user's reset is a real reset. A seed that outlived it
   * would be a persistent identifier defeating the only lever they have.
   *
   * Never emitted in telemetry (only the resulting true/false assignments
   * are), so it does not link the old id to the new one server-side.
   * Backfilled once for configs predating the field.
   */
  bucketSeed?: string;
  /**
   * Ring of the last few local renders (newest last). `hyperframes feedback`
   * attaches these ids — which are the `render_job_id` /
   * `observability_render_job_id` on this install's PostHog events — to the
   * feedback it submits, so a wild bug report can be joined to the exact
   * telemetry rows of the renders it describes.
   */
  recentRenders?: RecentRenderRecord[];
}

/** One entry in {@link HyperframesConfig.recentRenders}. */
export interface RecentRenderRecord {
  /** The render job id (`RenderJob.id` — the telemetry `render_job_id`). */
  id: string;
  /** ISO timestamp of when the render finished. */
  at: string;
  /** Whether the render completed successfully. */
  ok: boolean;
}

/** Ring size for {@link HyperframesConfig.recentRenders}. */
const MAX_RECENT_RENDERS = 5;

/**
 * Append a finished render to the recent-renders ring (newest last, capped).
 * Fresh read-modify-write like the trial counters — narrows, but does not
 * eliminate, lost updates against a concurrent CLI process.
 */
export function recordRecentRender(id: string, ok: boolean): void {
  const config = readConfigFresh();
  const ring = [...(config.recentRenders ?? []), { id, at: new Date().toISOString(), ok }];
  config.recentRenders = ring.slice(-MAX_RECENT_RENDERS);
  writeConfig(config);
}

const DEFAULT_CONFIG: HyperframesConfig = {
  telemetryEnabled: true,
  anonymousId: "",
  telemetryNoticeShown: false,
  commandCount: 0,
  renderSuccessCount: 0,
  lastFeedbackPromptAt: 0,
};

let cachedConfig: HyperframesConfig | null = null;

/** A non-empty string, or undefined — hand-edited configs can carry anything. */
function parseNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Shape-validate the recent-renders ring from a parsed config. */
function parseRecentRenders(value: unknown): RecentRenderRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (r): r is RecentRenderRecord =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RecentRenderRecord).id === "string" &&
        typeof (r as RecentRenderRecord).at === "string" &&
        typeof (r as RecentRenderRecord).ok === "boolean",
    )
    .slice(-MAX_RECENT_RENDERS);
}

/**
 * Read the config file, creating it with defaults if it doesn't exist.
 * Returns a mutable copy — call `writeConfig()` to persist changes.
 */
export function readConfig(): HyperframesConfig {
  if (cachedConfig) return { ...cachedConfig };

  if (!existsSync(CONFIG_FILE)) {
    const config = mintConfig();
    writeConfig(config);
    return config;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HyperframesConfig>;

    const config: HyperframesConfig = {
      telemetryEnabled: parsed.telemetryEnabled ?? DEFAULT_CONFIG.telemetryEnabled,
      anonymousId: parsed.anonymousId || randomUUID(),
      telemetryNoticeShown: parsed.telemetryNoticeShown ?? DEFAULT_CONFIG.telemetryNoticeShown,
      commandCount: parsed.commandCount ?? DEFAULT_CONFIG.commandCount,
      renderSuccessCount: parsed.renderSuccessCount ?? DEFAULT_CONFIG.renderSuccessCount,
      lastFeedbackPromptAt: parsed.lastFeedbackPromptAt ?? DEFAULT_CONFIG.lastFeedbackPromptAt,
      lastUpdateCheck: parsed.lastUpdateCheck,
      latestVersion: parsed.latestVersion,
      lastStalePinNoticeAt: parsed.lastStalePinNoticeAt,
      pendingUpdate: parsed.pendingUpdate,
      completedUpdate: parsed.completedUpdate,
      lastSkillsCheck: parsed.lastSkillsCheck,
      skillsUpdateAvailable: parsed.skillsUpdateAvailable,
      skillsOutdatedCount: parsed.skillsOutdatedCount,
      skillsMissingCount: parsed.skillsMissingCount,
      skillsRemovedCount: parsed.skillsRemovedCount,
      // Explicit `=== true`/typeof-number checks rather than a truthy/nullish
      // read — a hand-edited or corrupted config could plausibly carry a
      // non-boolean/non-number JSON value (e.g. the STRING "false", which is
      // truthy in JS) for these two fields specifically, since they're read
      // with a bare truthy check at the call site (review finding).
      deParallelRouterTrialFired: parsed.deParallelRouterTrialFired === true ? true : undefined,
      deParallelRouterTrialRenderCount:
        typeof parsed.deParallelRouterTrialRenderCount === "number"
          ? parsed.deParallelRouterTrialRenderCount
          : undefined,
      predecessorFound:
        typeof parsed.predecessorFound === "boolean" ? parsed.predecessorFound : undefined,
      stateFileCorrupt: parsed.stateFileCorrupt === true ? true : undefined,
      bucketSeed: parseNonEmptyString(parsed.bucketSeed),
      recentRenders: parseRecentRenders(parsed.recentRenders),
    };

    // One-time backfill for configs predating the bucket seed: prefer the
    // recorded seed if a previous install already wrote one, else mint.
    // Persisted immediately — an unpersisted seed would re-roll every process.
    if (config.bucketSeed === undefined) {
      backfillBucketSeed(config);
      // Cache even if the write failed, so the seed is at least stable for
      // the life of this process (a re-roll per readConfigFresh would flip
      // cohorts mid-session).
      cachedConfig = config;
      return { ...config };
    }

    cachedConfig = config;
    return { ...config };
  } catch {
    // A missing file is handled above. Any failure here means an existing
    // preference could not be read safely (corrupt JSON, permissions, I/O).
    // Recover through the same mint path as a missing file — so a tripped
    // breaker survives config corruption too — but fail closed for the
    // privacy control: recovery must never silently turn telemetry back on.
    const config = { ...mintConfig(), telemetryEnabled: false };
    writeConfig(config);
    return config;
  }
}

/**
 * Re-read the config from disk, bypassing the in-process cache. Use
 * immediately before a targeted single-field read-modify-write (e.g. the DE
 * parallel-router trial's render count/fired flag) to narrow — though not
 * eliminate, there is no cross-process file locking here — the window for a
 * lost update against a concurrently-running CLI process that wrote other
 * fields in the meantime.
 */
export function readConfigFresh(): HyperframesConfig {
  cachedConfig = null;
  return readConfig();
}

/**
 * Persist config to disk. Updates the in-memory cache on success.
 *
 * Atomic: writes to a pid-suffixed temp file and renames it over the config —
 * `rename(2)` within one directory is atomic on POSIX, so a concurrent
 * reader can never observe a partially-written file. That matters beyond
 * hygiene: `readConfig`'s corrupted-file catch RESETS the config to defaults
 * (new anonymousId, telemetry re-enabled, all optional fields wiped), so a
 * torn read of a non-atomic write would silently destroy the user's config
 * (review finding).
 *
 * Returns whether the write actually landed — errors are still swallowed
 * (telemetry must never break the CLI), but callers that need persistence
 * certainty (e.g. the DE parallel-router trial's off-switch) can react
 * instead of re-implementing read-back verification.
 */
export function writeConfig(config: HyperframesConfig): boolean {
  return writeConfigWithResult(config).ok;
}

export type ConfigWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Persist config and retain the failure reason for user-facing commands that
 * must distinguish a durable preference write from a best-effort update.
 */
export function writeConfigWithResult(config: HyperframesConfig): ConfigWriteResult {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const tmpFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmpFile, CONFIG_FILE);
    cachedConfig = { ...config };
    // Mirror into the install-state file (marker + tripped breaker) so no
    // breaker write site has to remember to do it.
    syncInstallState(config);
    return { ok: true };
  } catch (error) {
    // Non-fatal — telemetry should never break the CLI
    return { ok: false, error: normalizeErrorMessage(error) };
  }
}

/**
 * Increment the command counter and persist.
 */
export function incrementCommandCount(): number {
  const config = readConfig();
  config.commandCount++;
  writeConfig(config);
  return config.commandCount;
}

/** Expose the config directory path for the telemetry command output */
export const CONFIG_PATH = CONFIG_FILE;

/** Expose the install-state path for the telemetry command output. */
export const STATE_PATH = STATE_FILE;
