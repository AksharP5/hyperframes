/**
 * Containment for registry manifest paths.
 *
 * `registry-item.json` is untrusted input. `catalog-previews.yml` runs on
 * `pull_request` for any change under `registry/blocks/**` or
 * `registry/components/**`, so a contributor's own manifest reaches the preview
 * renderer, and the job then uploads `docs/images/catalog/` as an artifact.
 *
 * `join()` happily walks out of its first argument, so a `files[].path` of
 * `../../../../etc/passwd` reads an arbitrary runner file into the project, and
 * a `files[].target` of the same shape writes an arbitrary runner path. Both
 * sides have to be resolved and checked, not just the one that looks like input.
 */

import { isAbsolute, relative, resolve } from "node:path";

/** True when `candidate` resolves to `root` itself or something beneath it. */
export function isContainedIn(root, candidate) {
  const step = relative(resolve(root), resolve(root, candidate));
  return step === "" || (!step.startsWith("..") && !isAbsolute(step));
}

/**
 * The `[from, to]` pairs safe to copy, dropping any that escape `projectDir`.
 *
 * `exists` is injected so the containment rule can be tested without a fixture
 * tree — the traversal decision must not depend on whether the target happens
 * to be present on the runner.
 */
export function resolveContainedCopies(projectDir, files, exists) {
  const root = resolve(projectDir);
  return (files ?? [])
    .filter((file) => file?.path && file?.target)
    .filter((file) => isContainedIn(root, file.path) && isContainedIn(root, file.target))
    .map((file) => [resolve(root, file.path), resolve(root, file.target)])
    .filter(([from, to]) => from !== to && exists(from));
}
