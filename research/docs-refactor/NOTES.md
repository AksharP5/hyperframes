# HyperFrames documentation refactor notes

This is the working notebook for facts, judgments, questions, and progress. Keep raw observations here; keep durable decisions in `PLAN.md`.

## Baseline audit

- Public navigation contains 213 pages.
- 133 are catalog entries.
- 80 are non-catalog documentation pages.
- Current top tabs are Documentation, Catalog, Packages, SDK, and Reference.
- Product capability matrix: 82 capabilities.
  - Covered: 21
  - Partial: 29
  - Misplaced: 2
  - Wrong: 5
  - Missing: 25
- Studio capability matrix: 35 capabilities.
  - Covered: 1
  - Partial: 15
  - Misplaced: 1
  - Wrong: 2
  - Missing: 16
- Non-catalog docs contain about 130,000 words.
- The CLI package page alone contains more than 10,000 words.
- `mint validate` and `mint broken-links` passed before the refactor.
- Mintlify CLI currently needs Node 20 locally. Default Node 26 is unsupported.

## Confirmed content problems

- `introduction.mdx` says there is no timeline editor. This is false.
- `guides/timeline-editing.mdx` says split is unsupported. Studio ships split at playhead, a razor tool, and split-all behavior.
- Several guides use incomplete or outdated skills installation guidance.
- `packages/studio.mdx` documents the Studio package and embedding surface, not how to use the Studio product.
- `contributing/studio-manual-dom-editing.mdx` contains important user-facing Studio behavior in the wrong section.
- `weekly-updates.mdx` has almost no content.
- `guides/mcp.mdx` exists but is not in public navigation.
- `guides/website-to-video.mdx` describes a workflow now handled by Product Launch Video.
- Showcase and Launch Videos overlap.
- Claude Design and Open Design overlap.
- Common Mistakes and Troubleshooting overlap.

## Current Studio facts verified in source

- Storyboard and Preview modes.
- Storyboard board/source views, frame statuses, focus, comments, direction, voiceover iteration, and agent handoff.
- Canvas selection and direct manipulation: move, resize, rotate, crop, nudge, snapping, marquee, groups, and stacking order.
- Layers panel.
- Timeline move, trim, split, razor, split-all, snapping, beats, zoom, auto-keyframe, keyframe diamonds, nested composition expansion, breadcrumbs, and multi-drag.
- GSAP animation editing, speed curves, per-keyframe easing, keyframe CRUD and retiming, motion paths, gesture recording, and computed-tween unrolling.
- Property controls for text, layout, style, media, 3D, and color grading.
- Assets import, preview, cross-project assets, and timeline drag/drop.
- Blocks browsing, search, insertion, and drag/drop.
- Source editor and file tree.
- Variables creation, binding, and live preview.
- Captions timeline, properties, and animation.
- Slideshow slides, notes, fragment holds, branches, and hotspots.
- Lint modal and copy-issues-to-agent.
- Render queue with MP4, WebM, MOV, quality, resolution, FPS, cancel, download, delete, and hide-finished controls.
- Undo/redo, capture current frame, and Ask Agent.

## Navigation judgment

The existing navigation is repository-shaped:

- Packages, SDK, and Reference are separate top-level destinations.
- Studio has no top-level human manual.
- General workflows are mixed with implementation concepts and deployment.
- Important pages compete with changelog and empty weekly updates in Getting Started.

New navigation should be task-shaped:

- Guides
- Studio
- Catalog
- Developers

## Header judgment

- Use the native Mintlify Aspen theme.
- Aspen was tested with the real refactored docs at desktop and 390px mobile widths.
- It provides a genuine full-width top header with logo, search, GitHub, primary action, and theme toggle.
- It places the four section tabs in a second full-width row.
- Maple was rejected because its header began after the left sidebar and kept the logo and theme toggle inside the sidebar column.
- Current logo is already configured for light and dark modes.
- The default appearance now follows the user’s system setting.
- Add GitHub and a primary action.
- Confirm the canonical Studio URL before adding the primary action.
- The temporary primary action is **Get started** and points to Quickstart.
- Keep Aspen's full-width header. A desktop-only layout override is intentional so the logo, tabs, search, actions, and theme toggle fit on one row.

## Questions to verify during implementation

- What is the canonical public Studio URL?
- Is Studio always used locally, hosted publicly, or both?
- Which screenshots can be generated from stable fixture projects?
- Which product workflows deserve separate pages based on actual user questions?
- Should old release URLs remain public but hidden, or redirect to a release archive?
- Is there an existing analytics baseline for searches and failed searches?

## Work log

### 2026-07-28

- Completed repository and public-doc audit.
- Built validated interactive report in `research/docs-audit/report.html`.
- Selected four-tab architecture.
- Created persistent docs rules, plan, and notes.
- Rebuilt navigation as Guides, Studio, Catalog, and Developers.
- Added collapsible nested groups and folded all Catalog categories by default.
- Switched from Maple to Aspen after desktop and mobile visual comparison.
- Rewrote Introduction and Quickstart.
- Added Guides, Catalog, Developers, concepts, media, export, help, product-launch, and path-selection landing pages.
- Added a 17-page Studio user section.
- Retired the empty Weekly Updates page.
- Replaced the stale Website to Video and incorrect Timeline Editing pages with redirects.
- Added MCP to public navigation.
- Corrected the main outdated skills installation commands.
- Mintlify build validation and broken-link checks passed after the first implementation pass.

### 2026-07-28 — second pass

- Added sendable, task-first pages for project structure, faceless explainers, PR videos, captions and recuts, motion graphics, music-driven videos, general video, voice and audio, transcription, quality review, and publishing.
- Merged Claude Design and Open Design into one maintained Design tools page.
- Merged Common Mistakes into a symptom-first Troubleshooting hub and redirected the old URL.
- Merged Showcase and Launch Videos into one Examples page with real finished work, source links, and starter templates.
- Added a human-readable Product updates page while keeping Changelog as the complete release archive.
- Added a task-based CLI guide before the full command reference.
- Removed the buried Studio manual-editing page and redirected it to the current user-facing Canvas guide.
- Retired the overlapping video-editor cheatsheet in favor of the current Studio shortcuts and task guides.
- Added Authentication and the orphaned Motion Blur component to public navigation. Every remaining MDX page is now reachable from navigation.
- Captured the current Studio from the included storyboard fixture and added the real workspace image to the Studio tour.
- Added freshness and ownership rules to `docs/AGENTS.md`.
- Mintlify build validation and broken-link checks passed after the second pass.

### 2026-07-28 — Studio and Catalog verification pass

- Verified the Studio manual against current UI source, tests, and a running Studio fixture.
- Corrected conceptual or outdated panel names to the visible controls people actually see:
  - top bar: Storyboard, Preview, Capture, Inspector, Export;
  - left sidebar: Code, Comps, Assets, Catalog;
  - inspector: Design, Layers, Renders, Slideshow when applicable, Variables;
  - lower-left action: Lint.
- Verified Code autosave, Assets project scopes, Catalog insertion behavior, render formats and controls, lint handoff, storyboard status meanings, and current keyboard shortcuts.
- Added real 1280×720 Studio images for the workspace, Storyboard, Inspector, and Renders panel.
- Added a narrow `.gitignore` exception for `docs/images/studio/*.jpg` so these authored screenshots are included while generated Catalog media remains ignored.
- Corrected the Storyboard feedback loop to **Save & copy message** followed by pasting into agent chat.
- Documented that `SCRIPT.md`, when present, is the final narration source and that **Open in Preview** applies to built frames.
- Reworked the Catalog page generator for all 134 items:
  - removed duplicate body titles;
  - added a plain-language agent request;
  - kept the terminal command as an alternative;
  - moved files, dimensions, and embed markup into labeled technical accordions.
- Added a short Common questions page with sendable answers for the most likely first-use and support questions.
- Replaced the oversized Feedback Collection telemetry specification with a task-focused Share feedback guide. Kept the public-project warning and essential privacy explanation.
- Reviewed the new Common questions, Storyboard, and Catalog item pages in a local Mintlify preview.
- Mintlify local search results cannot be tested: the local preview explicitly reports “Not available on local preview.” Search-result quality must be checked after deployment or through Mintlify analytics.
- Mintlify validation and broken-link checks passed after this pass.

### 2026-07-28 — final editorial and structural pass

- Resolved the header destination:
  - Studio remains project-local through `npx hyperframes preview`;
  - the global header action is **Playground**, linking to the official `https://www.hyperframes.dev/` browser experience.
- Rewrote the remaining general-audience outliers:
  - Prompt Guide → a concise human brief and feedback guide;
  - The Pipeline → a flexible idea-to-export explanation rather than a mandatory internal process;
  - HyperFrames vs Remotion → a shorter, balanced decision guide with current Studio and licensing language;
  - Rendering → a task-first CLI render guide, leaving exhaustive flags in the CLI reference;
  - Video Components → a human guide for choosing and adapting Catalog visuals;
  - HyperFrames MCP → current host-aware setup with honest plan, workspace, and beta caveats.
- Corrected stale public documentation:
  - removed hard-coded skill counts that had already drifted from the repository;
  - replaced obsolete `validate` composition guidance with `npx hyperframes check`;
  - removed old Website to Video labels;
  - standardized the HyperFrames brand spelling;
  - removed the remaining duplicate body H1;
  - guaranteed a description for every generated Catalog page.
- Added Playground as a no-local-setup path in Introduction and Choose your path.
- Added `research/docs-audit/current-state.html`, a visual after-state dashboard alongside the baseline audit.
- Final structural inventory:
  - 253 public documentation pages after syncing the latest `main` branch;
  - 253 pages represented in navigation;
  - zero orphan pages;
  - zero missing navigation targets;
  - every MDX page has frontmatter, a title, and a description.
- Final visual review confirmed the full-width Aspen header, Playground action, rewritten guide rendering, Studio images, default Mintlify navigation behavior, and after-state dashboard.
- Final checks:
  - `mint validate` passed;
  - `mint broken-links` passed;
  - `oxlint` passed for changed scripts;
  - `git diff --check` passed.

### 2026-07-28 — navigation polish after preview review

- Restored the navigation behavior used on `origin/main`: ordinary top-level groups in every tab, with no nested root, directory, expanded, or drilldown behavior.
- Kept the refactored page inventory and the new Guides, Studio, Catalog, and Developers information architecture.
- Removed all custom sidebar hierarchy and **On this page** CSS so both surfaces use Mintlify's unchanged default rendering.
- Confirmed the result in a local Mintlify preview; validation and broken-link checks still pass.

### 2026-07-28 — final navigation visual correction

- Kept the Aspen theme, four refactored tabs, and current page groupings.
- Matched the deployed main docs' sidebar treatment: 14px medium group headings, square links, no horizontal dividers, and one border segment per page so the active segment tracks the current page. Groups remain open and non-collapsible.
- Kept Mintlify's right-side **On this page** surface completely unchanged.
- Fit the Aspen desktop header into one row, with the GitHub destination shown as a compact icon.

## Maintenance issue

- The repo instructions refer to `.agents/skills/hyperframes/SKILL.md`, but that repo-local path is absent in this checkout. The installed current router at `/Users/ularkimsanov/.agents/skills/hyperframes/SKILL.md` was used as the workflow source of truth for this pass.
