import { Sources, markupSnippet, mergeSnippets } from "./sources";
import type { InspectRequest, RuntimeResponse, Snippet } from "./types";
const KEPT_FIRST_UNDER_BUDGET = [
  "animation creation",
  "animation caller",
  "timeline attachment",
  "html opening tag",
  "animation source dependency",
  "matched CSS candidate",
];
const rank = (kind: string) => {
  const at = KEPT_FIRST_UNDER_BUDGET.indexOf(kind);
  return at === -1 ? KEPT_FIRST_UNDER_BUDGET.length : at;
};
const priority = (snippet: Snippet) => Math.min(...snippet.kind.map(rank));
const byPosition = (a: Snippet, b: Snippet) =>
  a.file.localeCompare(b.file) || a.startLine - b.startLine;
const CO_TARGETS_SHOWN = 3;

function shown(snippet: Snippet, targetCount: number) {
  const { id, kind, code, uniqueInFile, targets } = snippet;
  return targetCount === 1
    ? { id, kind, code, uniqueInFile }
    : { id, kind, targets, code, uniqueInFile };
}

export function mapInspection(
  raw: RuntimeResponse,
  request: InspectRequest,
  context: {
    sources: Sources;
    map: ReturnType<Sources["mapper"]>;
    catalog: Map<string, Snippet>;
    generation: string;
    sourceVersion: string;
    reused: boolean;
    start: number;
    visualState?: { time: number | undefined; duration: number | undefined };
  },
) {
  const { sources, map, catalog, generation, sourceVersion, reused, start, visualState } = context;
  const maxBytes = request.maxBytes ?? 12000;
  const collected: Snippet[] = [];
  const queriedRefs = new Set(raw.results.flatMap((result) => result.elements.map((el) => el.ref)));
  const results = raw.results.map((result, index) => {
    let unmappedAnimations = 0;
    for (const animation of result.animations) {
      const mapped = animation.stack ? map(animation.stack, index) : [];
      if (!mapped.length) unmappedAnimations++;
      collected.push(...mapped);
      for (const stack of animation.attachmentStacks)
        collected.push(
          ...map(stack, index).map((snippet) => ({ ...snippet, kind: ["timeline attachment"] })),
        );
    }
    for (const el of result.elements) {
      const snippet = markupSnippet(sources, el, index);
      if (snippet) collected.push(snippet);
    }
    for (const id of result.css) {
      const rule = sources.cssRules.find((rule) => rule.id === id);
      if (rule) {
        const snippet = sources.slice(
          rule.file,
          rule.start,
          rule.end,
          "matched CSS candidate",
          index,
        );
        if (snippet) collected.push(snippet);
      }
    }
    const coTargets = [
      ...new Map(
        result.animations
          .flatMap((animation) => animation.targets)
          .filter((element) => !result.elements.some((own) => own.ref === element.ref))
          .map((element) => [element.ref, element]),
      ).values(),
    ].sort((a, b) => Number(queriedRefs.has(a.ref)) - Number(queriedRefs.has(b.ref)));
    return {
      target: index,
      status: result.status,
      candidates: result.candidates,
      candidatesOmitted: 0,
      animations: result.animations.length,
      coTargets: coTargets.slice(0, CO_TARGETS_SHOWN),
      ...(coTargets.length > CO_TARGETS_SHOWN && {
        coTargetsOmitted: coTargets.length - CO_TARGETS_SHOWN,
      }),
      unmappedAnimations,
      scopeTruncated: result.truncated,
    };
  });
  const merged = mergeSnippets(collected, sources);
  for (const snippet of merged) catalog.set(snippet.id, snippet);
  let selected = [...merged].sort((a, b) => priority(a) - priority(b));
  if (request.snippets)
    selected = request.snippets.map((id) => {
      const snippet = catalog.get(id);
      if (!snippet) throw new Error(`unknown_snippet: ${id}`);
      return snippet;
    });
  const response = {
    generation: generation,
    visualState,
    sourceVersion: sourceVersion,
    reused,
    results,
    snippets: [] as ReturnType<typeof shown>[],
    omitted: [] as { id: string; bytes: number }[],
    omittedCount: 0,
    nextOffset: null as number | null,
    recordLimitReached: raw.recordLimitReached,
    hooked: raw.hooked,
    debugAvailable: true,
    elapsedMs: Math.round(performance.now() - start),
  };
  const offset = request.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("offset must be a non-negative integer");
  const size = () => Buffer.byteLength(JSON.stringify(response));
  const trimCandidates = (limit: number, keep: number) => {
    while (size() > limit) {
      const longest = response.results.reduce((a, b) =>
        b.candidates.length > a.candidates.length ? b : a,
      );
      if (longest.candidates.length <= keep) return;
      longest.candidates.pop();
      longest.candidatesOmitted++;
    }
  };
  trimCandidates(maxBytes / 2, 5);
  const targetCount = request.targets.length;
  const kept: Snippet[] = [];
  for (let i = offset; i < selected.length; i++) {
    response.snippets.push(shown(selected[i], targetCount));
    if (size() > maxBytes - 700) {
      response.snippets.pop();
      response.omittedCount = selected.length - i;
      response.omitted = selected
        .slice(i, i + 8)
        .map((item) => ({ id: item.id, bytes: Buffer.byteLength(item.code) }));
      const nothingFit = response.snippets.length === 0;
      response.nextOffset = nothingFit ? (i + 1 < selected.length ? i + 1 : null) : i;
      break;
    }
    kept.push(selected[i]);
  }
  if (!request.snippets)
    response.snippets = kept.sort(byPosition).map((snippet) => shown(snippet, targetCount));
  trimCandidates(maxBytes, 0);
  if (Buffer.byteLength(JSON.stringify(response)) > maxBytes)
    throw new Error("metadata_exceeds_budget: use fewer targets or increase maxBytes");
  if (request.debug) return { ...response, debug: raw };
  return response;
}
