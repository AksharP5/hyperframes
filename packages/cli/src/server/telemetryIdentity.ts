// ---------------------------------------------------------------------------
// CLI → Studio telemetry identity (Layer 1).
//
// The CLI owns both the Studio launch and the local server, so it seeds the
// browser with its own anonymous `config.anonymousId`. Studio adopts it as its
// distinct_id (see packages/studio/src/telemetry/distinctId.ts), so the CLI's
// `cli_command*` events and the browser's `studio:*` / `studio_*` / render
// events are attributed to one PostHog person.
//
// This uses ONLY the existing anonymous machine id (a random UUID, no PII), so
// the "no personal info" telemetry disclosure stays valid. When CLI telemetry
// is disabled (opt-out / dev / CI / DO_NOT_TRACK) nothing is seeded and Studio
// behaves exactly as if opened standalone.
//
// Kept out of studioServer.ts so it can be unit-tested without pulling in the
// server's heavy render dependencies (@hyperframes/producer, engine, …).
// ---------------------------------------------------------------------------

import { readConfig } from "../telemetry/config.js";
import { shouldTrack as telemetryShouldTrack } from "../telemetry/client.js";

/**
 * The CLI's anonymous distinct id to hand to Studio, or null when CLI telemetry
 * is disabled or no id is available. Fail-silent — telemetry must never break
 * the preview server.
 */
export function resolveCliTelemetryDistinctId(): string | null {
  try {
    if (!telemetryShouldTrack()) return null;
    const id = readConfig().anonymousId;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * `<script>` tag to inject into the served index.html `<head>`, publishing the
 * CLI distinct id as `window.__HF_CLI_DISTINCT_ID` before the studio bundle
 * runs. Preferred over a URL param so the id never leaks into `$current_url` /
 * `url_hash` telemetry or browser history. Empty string when there's nothing to
 * seed (telemetry off / no id).
 */
/**
 * The CLI's canary bucket seed to hand to Studio, or null. Injected alongside
 * the distinct id so a CLI-launched Studio buckets canaries on the SAME unit
 * as the CLI — without it the two surfaces would agree only while the seed
 * still equals whatever Studio falls back to, and a rollout spanning render
 * and editor would split one user across cohorts. Same telemetry gate as the
 * distinct id: seeding is part of the identity stitch, not a separate channel.
 */
export function resolveCliBucketSeed(): string | null {
  try {
    if (!telemetryShouldTrack()) return null;
    const seed = readConfig().bucketSeed;
    return typeof seed === "string" && seed.length > 0 ? seed : null;
  } catch {
    return null;
  }
}

// JSON.stringify does not escape "<" or "/". Escaping both means no
// "</script>" (or "</…") sequence can form in the emitted value, so it can
// never terminate the inline <script> or open a new tag. (The values are
// randomUUID()s, so this is belt-and-suspenders.)
function encodeInlineScriptValue(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\//g, "\\/");
}

export function buildCliIdentityScript(): string {
  const cliId = resolveCliTelemetryDistinctId();
  if (!cliId) return "";
  const parts = [`window.__HF_CLI_DISTINCT_ID=${encodeInlineScriptValue(cliId)};`];
  const seed = resolveCliBucketSeed();
  if (seed) parts.push(`window.__HF_CLI_BUCKET_SEED=${encodeInlineScriptValue(seed)};`);
  return `<script>${parts.join("")}</script>`;
}

/**
 * Compose the scripts injected into the served Studio `index.html` `<head>`.
 * The CLI identity script MUST come first so `window.__HF_CLI_DISTINCT_ID` is
 * set before the (deferred) Studio bundle runs telemetry init and reads it;
 * `envScript` is the existing `window.__HF_STUDIO_ENV__` injection. Keeping the
 * ordering in one pure, tested function guards against a future `<head>` inject
 * silently landing ahead of the identity script and reintroducing a boot race.
 */
export function buildStudioHeadScripts(envScript: string): string {
  return `${buildCliIdentityScript()}${envScript}`;
}
