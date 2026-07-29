# HyperFrames documentation refactor

## Current approval gate

Approved by the product owner on 2026-07-29. Public implementation is now in progress.

The approved journeys become the source of truth for:

- canonical starting links;
- page priority and order;
- required videos and diagrams;
- navigation;
- consolidation and removal decisions;
- analytics and usability tests.

The route-to-journey contract is maintained in `JOURNEY-IMPLEMENTATION-MAP.md`.

Status: implementation complete; post-release measurement remains
Started: 2026-07-28
Primary audience: people who want to make, edit, and share videos with HyperFrames
Secondary audience: developers integrating or extending HyperFrames

This is the durable plan for the documentation refactor. Read it before doing docs work, including after a chat compaction or in a future session.

## Goal

Turn the docs from a repository-shaped collection of pages into a useful product guide.

A visitor should quickly understand:

- what HyperFrames does;
- whether they should use an agent, Studio, or both;
- how to complete a real video task;
- where to find a feature they saw in the product;
- what to send someone who asks “how do I do this?”;
- where technical reference lives when they actually need it.

The docs should feel clear, capable, visual, and human. They should not read like an API dump, marketing filler, or instructions written only for framework contributors.

## Navigation decision

Use four top-level header tabs:

1. **Guides** — start here, create with an agent, workflows, core ideas, media, export, troubleshooting, and product updates.
2. **Studio** — the complete visual editor manual.
3. **Catalog** — browsable blocks and components.
4. **Developers** — CLI, SDK, packages, schemas, deployment, integrations, and contributing.

Global header:

- Use Mintlify’s **Aspen** theme. A desktop and mobile preview confirmed that it provides the desired full-width header without custom CSS.
- HyperFrames logo on the left.
- Search remains prominent.
- GitHub link on the right.
- Light/dark theme toggle remains available.
- Primary **Playground** action to the official `hyperframes.dev` browser experience. Studio itself remains project-local through `npx hyperframes preview`.
- Keep Aspen’s full-width top navigation. Use the small desktop-only layout override needed to fit the logo, tabs, search, actions, and theme toggle on one row.
- Keep every left-sidebar group open and non-collapsible. Match the deployed main docs' spacing, group-heading scale, square link treatment, and segmented active-page rail.
- Keep Mintlify’s default right-side **On this page** behavior and styling.
- Align Aspen's sticky sidebar to the actual 56px header, remove its premature scroll fade, keep the GitHub star count, and use main's quieter structural border color.
- Keep the floating agent input easy to notice without making it visually dominant.

Navigation behavior:

- Every tab uses ordinary top-level groups, matching `origin/main`.
- Group labels are static section headings; only actual pages navigate.
- Do not add `root`, `directory`, `expanded`, or drilldown behavior.
- Keep Mintlify's default sidebar and **On this page** rendering unchanged.
- Human-facing labels describe tasks, not repository packages.
- Updates is not a top-level tab.

## Target information architecture

### Guides

- Start here
  - What HyperFrames is
  - Choose your path
  - Make your first video
  - How a project works
- Create with an agent
  - Choose a workflow
  - Give the agent a useful brief
  - Review and improve a result
  - Product and website videos
  - Explainers
  - PR and changelog videos
  - Captions and talking-head recuts
  - Motion graphics
  - Music-driven videos
  - Slideshows
- Learn
  - Composition basics
  - Timing and tracks
  - Animation basics
  - Reusable variables
  - Nested compositions
  - Deterministic rendering
- Media
  - Images and video
  - Voice and audio
  - Captions and transcription
  - Background removal
  - Color grading
- Export and share
  - Choose a format
  - Export from Studio
  - Render from the CLI
  - 4K and HDR
  - Publish and share
- Help
  - Troubleshooting
  - Common questions
  - Give feedback
- What’s new
  - Product updates
  - Detailed release archive

### Studio

- Studio overview and tour
- Storyboard
- Canvas editing
- Layers and groups
- Timeline editing
- Animation and keyframes
- Assets and reusable blocks
- Text, layout, style, media, 3D, and color controls
- Captions
- Variables and templates
- Slideshows
- Source editor
- Lint and fixing issues
- Export queue
- Keyboard shortcuts
- Troubleshooting

### Catalog

- Visual catalog home
- Blocks
- Components
- Categories and search
- Add an item
- Customize an item
- Build and contribute an item

Individual item pages stay concise and visual. Their shared generator owns the agent prompt, install path, and progressive disclosure of technical details.

### Developers

- Developer overview
- CLI
- SDK
- Player
- Packages
- HTML schema
- Advanced rendering
- Deployment
- MCP and integrations
- Contributing
- Release process

## Content decisions

- Rewrite Introduction and Quickstart around outcomes and user paths.
- Create real Studio documentation from current product behavior.
- Move user-facing Studio material out of Contributing.
- Merge Packages, SDK, and Reference into Developers.
- Remove Weekly updates until it has real content and an owner.
- Keep one human-readable product updates page and one detailed release archive.
- Merge Showcase and Launch Videos into one examples area.
- Merge overlapping Claude Design and Open Design guidance.
- Replace the stale Website to Video workflow with the current Product Launch workflow.
- Merge Common Mistakes into a useful troubleshooting hub.
- Replace the giant CLI wall with task guides plus a searchable command reference.
- Add the MCP guide to navigation.
- Correct installation guidance:
  - Agent/non-interactive default: `npx hyperframes skills update`
  - Interactive picker: `npx skills add heygen-com/hyperframes --full-depth`

## Writing principles

- Lead with the result, not setup.
- Use “you” and name visible controls exactly as they appear.
- One page, one main job.
- Prefer short sentences and meaningful headings.
- Show a successful path before edge cases.
- Explain technical vocabulary the first time it appears.
- Do not make humans learn internal architecture unless it helps them act.
- Do not hide important caveats.
- No filler introductions, fake enthusiasm, or repetitive summaries.
- Use screenshots, short clips, diagrams, and examples when they reduce uncertainty.
- Technical detail belongs in a Developer section or a clearly labeled advanced section.

## Evidence standard

Every feature claim must come from at least one current source:

- shipped product code;
- tests;
- CLI help/output;
- schemas and public types;
- current agent skills;
- a confirmed live product flow.

Old docs and changelogs are leads, not proof.

## Execution phases

### Phase 1 — Foundation

- [x] Audit public pages and product capabilities.
- [x] Produce a visual coverage report.
- [x] Agree on four top-level tabs.
- [x] Create persistent plan, notes, and docs rules.
- [x] Implement the header/navigation shell.
- [x] Add overview pages required by the new hierarchy.

### Phase 2 — Critical truth fixes

- [x] Remove the “no timeline editor” claim.
- [x] Correct timeline splitting guidance.
- [x] Correct skills installation commands in the main user paths.
- [x] Add MCP to navigation.
- [x] Remove or redirect the empty Weekly Updates page and stale Website to Video and Timeline Editing pages.

### Phase 3 — Human starting experience

- [x] Rewrite Introduction.
- [x] Rewrite Quickstart.
- [x] Add Choose your path.
- [x] Add workflow chooser.
- [x] Rebuild examples around real outcomes.

### Phase 4 — Studio

- [x] Create the first complete Studio section.
- [x] Verify each control and workflow in current code.
- [x] Add the first real Studio workspace visual.
- [x] Add focused visuals for difficult interactions.
- [x] Move or redirect the buried manual-editing page.

### Phase 5 — Consolidation

- [x] Consolidate the highest-impact overlapping guides.
- [x] Reorganize developer material under one top-level section.
- [x] Add a task-based CLI guide in front of the complete command reference.
- [x] Separate product updates from raw release history.
- [x] Improve catalog browsing and repeated item content.

### Phase 6 — Quality and maintenance

- [x] Run Mintlify validation and broken-link checks.
- [x] Review desktop and mobile navigation.
- [x] Add and visually review sendable routes for common user questions.
- [x] Add page ownership and freshness rules.
- [ ] After release, use Mintlify analytics to inspect real searches, no-result queries, and weak result ranking.

## Deliverables

- Visual audit: `../docs-audit/report.html`
- Audit data: `../docs-audit/audit-data.json`
- Working notes: `NOTES.md`
- Documentation rules: `../../docs/AGENTS.md`
- Refactored Mintlify site: `../../docs/`
