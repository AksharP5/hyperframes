/**
 * What the collapsed Audio FX group says it holds.
 *
 * Its own module because `PropertyPanelFlat.tsx` is at the repo's 600-line
 * budget, and this is the piece with no dependency on the panel around it.
 */

import { parseAudioFxChain } from "@hyperframes/core/audio-fx";
import type { DomEditSelection } from "./domEditing";

/** Chain length at a glance, so the collapsed group says whether anything is on. */
export function audioFxSummary(element: DomEditSelection): string {
  const raw = element.dataAttributes?.["fx-chain"];
  const carve = element.dataAttributes?.["fx-carve"];
  let count = 0;
  if (raw) {
    try {
      count = parseAudioFxChain(raw).nodes.filter((n) => n.enabled !== false).length;
    } catch {
      return "unreadable";
    }
  }
  const parts: string[] = [];
  if (count > 0) parts.push(`${count} effect${count === 1 ? "" : "s"}`);
  if (carve) parts.push("carve");
  return parts.length > 0 ? parts.join(" + ") : "none";
}
