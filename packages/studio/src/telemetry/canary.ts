// ---------------------------------------------------------------------------
// Studio (browser) binding for the shared canary registry.
//
// `@hyperframes/core` owns the decision and is deliberately pure — the caller
// supplies the unit id, the override and the exclusion. This file supplies
// those three from the browser, mirroring `packages/cli/src/telemetry/canary.ts`
// for the CLI. The public API is deliberately identical on both surfaces:
//
//   import { isCanaryEnabled } from "../telemetry/canary";
//   if (isCanaryEnabled("my-feature")) { ... }
//
// so a call site reads the same whether it runs in Node or the browser, and a
// canary can span both.
//
// Three things differ from the CLI, each for a reason:
//
// 1. UNIT ID — the CLI's bucket seed (`window.__HF_CLI_BUCKET_SEED`) when the
//    CLI launched Studio, so both surfaces bucket on the SAME unit and a
//    rollout spanning render and editor is coherent for that user. Standalone
//    Studio falls back to `resolveStudioDistinctId()` — the browser has no
//    second storage location, so its localStorage id doubles as the seed.
//
// 2. OVERRIDE — there is no `process.env` in a page, so the override is a URL
//    query param mirrored into sessionStorage (see `readOverride`).
//
// 3. EXCLUSION — `navigator.webdriver` stands in for the CLI's `is_ci`.
//    Automated browsers mint a fresh localStorage id per run, so their ids are
//    ephemeral and they would hop cohorts between runs — noise in the rollout
//    signal, and nothing learned about real users.
// ---------------------------------------------------------------------------

// Deep subpath imports, NOT the "@hyperframes/core" barrel. Studio is a
// browser bundle, and the barrel re-exports the whole core surface (parsers,
// lint, studio-server); pulling that in here drags a Node-oriented dependency
// graph into the bundle. These two modules are pure and leaf.
import {
  canaryFeatureProperties,
  evaluateCanary,
  parseCanaryOverride,
  type CanaryDecision,
} from "@hyperframes/core/canary";
import { CANARIES, findCanary } from "@hyperframes/core/canary-registry";
import { resolveStudioDistinctId } from "./distinctId";
import { isOptedOut } from "./config";
import { safeSessionStorage } from "../utils/safeStorage";

/** `my-feature` → `hf_canary_my_feature`, the query param and storage key. */
export function canaryParamName(name: string): string {
  return `hf_canary_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

// Injected by the CLI's studio server alongside __HF_CLI_DISTINCT_ID.
declare global {
  interface Window {
    __HF_CLI_BUCKET_SEED?: string;
  }
}

/**
 * The bucketing unit. A CLI-launched Studio buckets on the CLI's SEED (which
 * survives config wipes via the install-state file), not its distinct id —
 * the CLI itself buckets on the seed, and the two surfaces must agree per
 * machine. Standalone Studio falls back to its own distinct id: the browser
 * has no second storage location, so localStorage IS both id and seed there.
 */
function resolveBucketUnit(): string {
  try {
    const seed = typeof window === "undefined" ? undefined : window.__HF_CLI_BUCKET_SEED;
    if (typeof seed === "string" && seed.length > 0) return seed;
  } catch {
    /* fall through */
  }
  return resolveStudioDistinctId();
}

const STORAGE_PREFIX = "hyperframes-studio:canary:";

/**
 * Resolve a manual override for one canary.
 *
 * `?hf_canary_my_feature=on` (also off/true/false/1/0/yes/no), mirrored into
 * sessionStorage so it survives in-app navigation and reloads within the tab.
 *
 * SESSION scope, not local, is the deliberate part. A URL is the right carrier
 * — it is shareable, which is what "support: open this link" and "QA: repro
 * with this on" actually need. But persisting a URL-borne override to
 * localStorage would mean one click silently pins that browser into a cohort
 * forever, long after anyone remembers why. Session scope keeps the link
 * useful and lets closing the tab be the reset.
 *
 * `?hf_canary_my_feature=reset` clears it explicitly.
 */
function readOverride(name: string): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const key = canaryParamName(name);
  const storageKey = `${STORAGE_PREFIX}${name}`;
  const store = safeSessionStorage();

  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get(key);
  } catch {
    raw = null;
  }

  if (raw !== null) {
    if (raw.trim().toLowerCase() === "reset") {
      store?.removeItem(storageKey);
      return undefined;
    }
    // Persist for the tab session so the override outlives the query string.
    try {
      store?.setItem(storageKey, raw);
    } catch {
      /* storage full / blocked — the param still applies to this page load */
    }
    return parseCanaryOverride(raw);
  }

  return parseCanaryOverride(store?.getItem(storageKey) ?? undefined);
}

/**
 * Automated browser? The browser analog of the CLI's CI exclusion.
 * `navigator.webdriver` is set by Playwright, Puppeteer and Selenium.
 */
function isAutomatedBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.webdriver === true;
}

/**
 * Memoized per page load, for the same reason the CLI memoizes per process: a
 * canary must not change its mind mid-session. A component that mounted
 * enrolled has to stay enrolled, and the telemetry has to agree with what the
 * user actually saw.
 */
const decisions = new Map<string, CanaryDecision>();

/** Test-only: drop memoized decisions so cases don't leak into each other. */
export function __resetStudioCanaryCacheForTests(): void {
  decisions.clear();
}

/**
 * Full decision including the reason. An unregistered name resolves to off
 * rather than throwing — a typo in a rollout control must never break the
 * editor.
 */
export function resolveCanary(name: string): CanaryDecision {
  const cached = decisions.get(name);
  if (cached) return cached;

  const definition = findCanary(name);
  const override = definition ? readOverride(definition.name) : undefined;
  // Opting out of telemetry opts you out of canaries — same rule as the CLI
  // (see packages/cli/src/telemetry/canary.ts). An install that sends nothing
  // can't be compared against anyone, so enrolling it changes that user's
  // code path for no signal. An explicit override still wins: that is a
  // deliberate local choice, not silent enrolment.
  const decision: CanaryDecision = !definition
    ? { enabled: false, reason: "out_of_cohort" }
    : override === undefined && isOptedOut()
      ? { enabled: false, reason: "telemetry_opt_out" }
      : evaluateCanary({
          feature: definition.name,
          unitId: resolveBucketUnit(),
          percentage: definition.percentage,
          override,
          exclude: isAutomatedBrowser(),
        });

  decisions.set(name, decision);
  return decision;
}

/** Is this canary on for this Studio install? The everyday call. */
export function isCanaryEnabled(name: string): boolean {
  return resolveCanary(name).enabled;
}

/**
 * Canary assignments as PostHog flag properties (`$feature/canary-<name>`),
 * attached to every Studio event so any metric can be split by cohort —
 * identical shape to the CLI, so a rollout spanning both reads as one flag.
 */
export function canaryEventProperties(): Record<string, string> {
  return canaryFeatureProperties(
    CANARIES.map((c) => ({ name: c.name, enabled: resolveCanary(c.name).enabled })),
  );
}
