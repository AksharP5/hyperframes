import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const assembleScript = join(scriptDir, "assemble-index.mjs");
const transitionsScript = join(scriptDir, "transitions.mjs");

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function frameWithoutRootDuration(id, duration) {
  return `<template>
  <div data-composition-id="${id}" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["${id}"] = gsap.timeline({ paused: true }).to({}, { duration: ${duration} });
    </script>
  </div>
</template>`;
}

test("assembly materializes frame root duration before transition injection", () => {
  const project = mkdtempSync(join(tmpdir(), "frame-root-duration-"));
  try {
    write(
      join(project, "STORYBOARD.md"),
      `---
format: 1920x1080
---

## Frame 1 — First

- duration: 2s
- transition_in: cut
- status: animated
- src: compositions/frames/01-first.html

## Frame 2 — Second

- duration: 2s
- transition_in: crossfade 0.5s
- status: animated
- src: compositions/frames/02-second.html
`,
    );
    const firstPath = join(project, "compositions", "frames", "01-first.html");
    const secondPath = join(project, "compositions", "frames", "02-second.html");
    write(firstPath, frameWithoutRootDuration("01-first", 2));
    write(secondPath, frameWithoutRootDuration("02-second", 2));

    execFileSync(
      process.execPath,
      [assembleScript, "--storyboard", join(project, "STORYBOARD.md"), "--hyperframes", project],
      { encoding: "utf8" },
    );

    assert.match(
      readFileSync(firstPath, "utf8"),
      /data-composition-id="01-first"[^>]*data-duration="2"/,
    );
    assert.match(
      readFileSync(secondPath, "utf8"),
      /data-composition-id="02-second"[^>]*data-duration="2"/,
    );

    assert.doesNotThrow(() =>
      execFileSync(
        process.execPath,
        [
          transitionsScript,
          "inject",
          "--storyboard",
          join(project, "STORYBOARD.md"),
          "--hyperframes",
          project,
        ],
        { encoding: "utf8", stdio: "pipe" },
      ),
    );
    assert.match(
      readFileSync(firstPath, "utf8"),
      /data-composition-id="01-first"[^>]*data-duration="2.5"/,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
