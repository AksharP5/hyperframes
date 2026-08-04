import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isContainedIn, resolveContainedCopies } from "./registry-target-paths.mjs";

const ROOT = "/tmp/hf-catalog-demo";
const always = () => true;

test("ordinary manifest entries are copied", () => {
  const copies = resolveContainedCopies(
    ROOT,
    [{ path: "demo.html", target: "compositions/demo.html" }],
    always,
  );
  assert.deepEqual(copies, [[`${ROOT}/demo.html`, `${ROOT}/compositions/demo.html`]]);
});

// Both fields are attacker-controlled: catalog-previews.yml runs on
// pull_request for any registry change, so the manifest arrives from the PR.

test("a traversing path cannot read outside the project", () => {
  const copies = resolveContainedCopies(
    ROOT,
    [{ path: "../../../../etc/passwd", target: "leak.txt" }],
    always,
  );
  assert.deepEqual(copies, []);
});

test("a traversing target cannot write outside the project", () => {
  const copies = resolveContainedCopies(
    ROOT,
    [{ path: "demo.html", target: "../../../../home/runner/.bashrc" }],
    always,
  );
  assert.deepEqual(copies, []);
});

test("an absolute path or target is refused on either side", () => {
  assert.deepEqual(
    resolveContainedCopies(ROOT, [{ path: "/etc/passwd", target: "leak.txt" }], always),
    [],
  );
  assert.deepEqual(
    resolveContainedCopies(ROOT, [{ path: "demo.html", target: "/etc/cron.d/x" }], always),
    [],
  );
});

test("traversal that returns inside the project is allowed", () => {
  const copies = resolveContainedCopies(
    ROOT,
    [{ path: "nested/../demo.html", target: "out/demo.html" }],
    always,
  );
  assert.deepEqual(copies, [[`${ROOT}/demo.html`, `${ROOT}/out/demo.html`]]);
});

test("a sibling directory sharing the project's prefix is still outside", () => {
  assert.equal(isContainedIn(ROOT, "../hf-catalog-demo-evil/x"), false);
});

test("containment does not depend on the file existing", () => {
  assert.equal(isContainedIn(ROOT, "../../etc/passwd"), false);
  assert.deepEqual(
    resolveContainedCopies(ROOT, [{ path: "../../etc/passwd", target: "x" }], () => true),
    [],
  );
});

test("incomplete entries are skipped rather than resolved", () => {
  assert.deepEqual(
    resolveContainedCopies(ROOT, [{ path: "demo.html" }, { target: "x" }, {}], always),
    [],
  );
});
