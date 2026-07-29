# HyperFrames documentation user journeys

Status: **Approved; corrected after rendered-page review**

## Decision requested

Approve or change:

1. the primary journeys and their priority;
2. the single starting URL for each journey;
3. the success state each journey must produce;
4. the proposed videos, diagrams, and interactive formats;
5. which journeys ship first.

The recommendation is to approve journeys 1–5 as the primary documentation product. Journeys 6–7 are important, but secondary.

## The organizing principle

The docs are not a library that people should explore from the beginning.

Each person arrives with:

- a situation;
- one immediate question or job;
- some knowledge they already have;
- a result they need next.

Every primary journey therefore gets:

- one link we can confidently send;
- a first screen that confirms they are in the right place;
- a short sequence with no dead ends;
- proof of what HyperFrames produces;
- one clear next action;
- a measurable success state.

Navigation, pages, videos, examples, and reference material should derive from these journeys. A page that supports no approved journey, no real support question, and no required reference should be merged, hidden, or removed.

## Priority summary

| Priority | Journey                                | Canonical starting link | The person succeeds when…                                            |
| -------- | -------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| P0       | 1. Understand HyperFrames from zero    | `/introduction`         | They can explain HyperFrames simply and choose a relevant next step. |
| P0       | 2. Make a first real video             | `/quickstart`           | They export or reach a reviewable first video.                       |
| P0       | 3. Start a specific creation workflow  | `/workflows` proposed   | The correct workflow starts with useful inputs and expectations.     |
| P0       | 4. Review and edit an existing project | `/studio`               | They make a visible change or export a version.                      |
| P0       | 5. Recover when something is wrong     | `/help` proposed        | They diagnose the symptom and return to their original task.         |
| P1       | 6. Integrate or automate HyperFrames   | `/developers`           | They choose the correct surface and complete a working integration.  |
| P1       | 7. Find and reuse a visual             | `/catalog`              | They choose, add, and adapt a suitable Catalog item.                 |

---

## Journey 1 — Understand HyperFrames from zero

### Situation

Someone receives a link from a colleague, a support reply, GitHub, a social post, or a product conversation. They have no useful mental model of HyperFrames.

Their actual question is not “How do I install it?”

It is:

> What is HyperFrames, what can it make, and why would I use it?

### One link to send

`/introduction`

This must be the canonical explanation of HyperFrames. A teammate should be able to send only this link instead of giving a five-minute presentation.

### First screen

The first viewport should show immediate proof:

- a small set of realistic requests;
- the selected request in plain language;
- its finished HyperFrames video beside or directly below it;
- normal video controls, including audio when the source has audio;
- one useful next link: **Make your first video**.

Do not add a paragraph that explains how to use the page. Do not add a button
that only scrolls a few pixels. No installation command, schema term, package
name, or rendering architecture should appear before the person sees the
product.

### Exact journey

1. **Recognize the product**
   - See the one-sentence definition and a finished result immediately.
2. **Understand the loop**
   - One deliberately simple diagram:

     `Your request → AI agent → HyperFrames project → Video`

3. **See credible outcomes**
   - Three short examples, deliberately different:
     - product or website video;
     - explainer or motion graphic;
     - edited footage, captions, or presentation.
4. **Understand human control**
   - Show that the agent creates the first version and Studio is where a person reviews, edits, and exports.
5. **Choose one next path**
   - Explore the Playground.
   - Make a first video.
   - Open a project in Studio.
   - Integrate as a developer.

### Best formats

- A playable “What is HyperFrames?” example made in HyperFrames.
- A static, accessible four-step diagram.
- A prompt/result gallery that changes the visible example without leaving the page.
- A “what do you want to do?” choice at the end, not at the top.

### Success test

After 30–60 seconds, a person should be able to say:

> I give an agent an idea or source. It creates a real HyperFrames project. I can review and edit it in Studio, then export the result.

If they describe HyperFrames only as “HTML-to-video,” “a rendering engine,” or “a collection of AI skills,” this page has failed for the general audience.

### Current gap

The Introduction now begins with a compact prompt/result gallery and follows
with the four-step product loop. It does not repeat the Guides overview or ask
the visitor to choose between several large cards.

---

## Journey 2 — Make a first real video

### Situation

The person understands the basic idea and wants to try it. They may have:

- a website;
- notes or a script;
- existing footage;
- a pull request;
- music;
- only an idea.

Their question is:

> What is the shortest path from what I have to a result I can watch?

### One link to send

`/quickstart`

### First screen

Show:

- the result they will reach: **a reviewable first video in Studio**;
- realistic time and requirements;
- a visual “What do you have?” chooser;
- one copyable agent request;
- a still or short loop of the expected Studio result.

The page should not begin as an installation manual.

### Exact journey

1. **Choose the starting material**
   - Website or product.
   - Text, notes, or idea.
   - Existing footage.
   - PR or code change.
   - Music.
2. **Copy a useful request**
   - The request changes based on the chosen starting material.
3. **Install only what is required**
   - Keep the command short and explain what happens after it.
4. **Approve the creative direction**
   - Show a real example of the brief the agent returns.
5. **Watch the first version**
   - Explain what “done enough to review” looks like.
6. **Review in Studio**
   - Show one direct edit and one broader agent revision.
7. **Export**
   - End with a visible MP4 or other intended output.

### Best formats

- A chaptered 75–90 second end-to-end walkthrough.
- A copy button for each useful agent request.
- A small progress rail: **Request → Brief → Build → Review → Export**.
- An “expected result” image after important steps.
- Expandable setup details for people whose environment differs.

### Success test

The person reaches a video they can play in Studio or exports a first MP4. Merely completing installation does not count as success.

### Current gap

The current Quickstart contains most required steps and is substantially better than the old docs. It still needs a complete visual walkthrough, stronger expected-result states, and a material-first chooser before setup.

---

## Journey 3 — Start a specific creation workflow

### Situation

This person already understands HyperFrames. They return because they need to make something specific:

- a product launch;
- an explainer;
- a PR video;
- captions;
- a talking-head recut;
- a motion graphic;
- a music-driven video;
- a presentation;
- another custom video.

Their question is:

> Which path fits this job, and what should I give the agent?

### One link to send

Proposed: `/workflows`

This would replace `/guides/create-with-agent` as the human-facing canonical workflow chooser. Old URLs can redirect.

### First screen

Use an outcome gallery, not a table of internal workflow names.

Each card should show:

- a short playable result;
- “use this when…”;
- required starting material;
- expected output;
- approximate scope.

### Exact journey

1. **Choose by intended result or source material.**
2. **See a finished example before instructions.**
3. **Confirm that the workflow fits.**
4. **Copy a strong starter request.**
5. **Know what the agent will ask or decide.**
6. **Review workflow-specific risks.**
7. **Continue to Studio or export.**

### Standard for every workflow page

Every workflow page should contain, in this order:

1. playable finished example;
2. when to use it and when not to;
3. what to provide;
4. copyable agent request;
5. what the agent will confirm;
6. what a good first result contains;
7. workflow-specific review checklist;
8. common problems;
9. next step in Studio or export.

Internal skill installation, package details, and implementation contracts should be secondary or under Developers.

### Best formats

- Visual workflow cards with 6–12 second loops.
- “I have…” and “I want…” filters.
- Copyable requests that use real source material.
- Before/after examples for captions, recuts, and media workflows.
- Review checklists tailored to each output.

### Success test

The person starts the correct workflow with enough context for a useful first result. They should not need to learn the skill router or memorize internal workflow names.

### Current gap

The current Create with an agent page is accurate, but it behaves like a workflow reference table. It begins with installation and internal names rather than visual outcomes.

---

## Journey 4 — Review and edit an existing project

### Situation

An agent or teammate already created a HyperFrames project. The person opens Studio and needs to understand what they are seeing.

Their question is:

> How do I review this project, make the change I need, and export it safely?

### One link to send

`/studio`

### First screen

Show the actual Studio workspace with:

- a 60–90 second annotated tour;
- one sentence describing Storyboard versus Preview;
- six task choices:
  - review the story;
  - edit text or design;
  - change timing;
  - adjust animation;
  - add media;
  - export.

### Exact journey

1. **Open the project.**
2. **Understand Storyboard versus Preview.**
3. **Play the whole result once.**
4. **Choose the visible task.**
5. **Make one safe edit.**
6. **Know when to ask the agent instead.**
7. **Run checks or resolve a warning.**
8. **Export a version.**

### Best formats

- A real annotated Studio video, not a conceptual animation.
- A clickable workspace image with labeled hotspots.
- Short silent loops for trim, split, select, keyframe, and export.
- “Use Studio / ask the agent” examples beside relevant controls.
- A persistent “return to your task” link after conceptual detours.

### Success test

The person makes one visible change or exports a version without needing to understand the HTML architecture.

### Current gap

The current Studio section is the strongest new part of the docs and has verified screenshots. It still lacks a short end-to-end visual tour and task-level motion demonstrations.

---

## Journey 5 — Recover when something is wrong

### Situation

The person is already doing another job. Studio does not open, media is missing, preview differs from render, an element cannot be selected, or export fails.

Their question is:

> How do I get unstuck without reading the whole documentation site?

### One link to send

Proposed: `/help`

Specific support replies should link to an exact symptom section or focused page, not only the hub.

### First screen

Show a symptom chooser:

- Studio will not open.
- Preview is wrong or stale.
- I cannot select or edit something.
- Media is missing or black.
- Animation is wrong.
- Render failed or differs from preview.
- I have an error message.

Include a prominent “copy diagnostics for my agent” action.

### Exact journey

1. **Choose the visible symptom.**
2. **Run only the smallest useful diagnostic.**
3. **Compare expected and actual behavior.**
4. **Try the safest likely fix.**
5. **Copy a complete context block to the agent if unresolved.**
6. **Return to the original task.**

### Best formats

- Symptom-first cards.
- Exact error search.
- Copyable diagnostic bundle.
- Small “expected / wrong” visuals.
- Decision trees only where two or more causes look identical.
- Sendable URLs for the ten most frequent support questions.

### Success test

The person returns to the task they were trying to finish. Running `doctor`, `lint`, or `check` is a step, not the outcome.

### Current gap

Troubleshooting is now symptom-oriented, but it is still a long page. The Help landing page should become the clearer recovery entrance, with the most common problems split into highly sendable routes.

---

## Journey 6 — Integrate or automate HyperFrames

### Situation

A developer already knows the product and wants to:

- automate project creation or rendering;
- inspect or mutate compositions;
- embed playback;
- deploy render infrastructure;
- extend Studio or the framework.

Their question is:

> Which technical surface is the smallest one that solves my integration?

### One link to send

`/developers`

### First screen

Show a decision diagram:

- command or CI job → CLI;
- application edits compositions → SDK;
- embedded playback → Player;
- custom infrastructure → packages and deployment;
- generation or validation → schema and reference.

### Exact journey

1. Choose the smallest surface.
2. Complete one five-minute working quickstart.
3. See the input and output contract.
4. Continue to task guides.
5. Use reference only when implementation requires it.
6. Validate and deploy.

### Best formats

- Technical surface decision diagram.
- Runnable quickstarts with expected output.
- Architecture diagram that reveals detail progressively.
- Reference tables separated from task guides.
- Copy-for-agent and copy-for-terminal options.

### Success test

The developer completes a working render, mutation, embed, or deployment using the correct surface without importing the entire framework.

### Current gap

The Developers landing page has the correct categories. The technical section still needs end-to-end quickstarts and a clearer architecture/surface decision diagram.

---

## Journey 7 — Find and reuse a visual

### Situation

The person knows the project needs a chart, caption style, transition, lower third, code animation, map, or complete scene.

Their question is:

> Does HyperFrames already have a useful starting point, and how do I adapt it?

### One link to send

`/catalog`

### Exact journey

1. Browse by visual job.
2. Preview motion without opening each page.
3. Compare a few suitable items.
4. Open one item.
5. Copy an agent request or installation command.
6. Replace content, timing, and style.
7. Review it inside the complete video.

### Best formats

- Autoplay-on-hover preview loops with accessible still images.
- Filters by outcome, not implementation category alone.
- “Ask your agent to add this” as the primary action.
- Technical files and embed details collapsed by default.
- Related alternatives on every item page.

### Success test

The person adds and adapts a suitable visual instead of rebuilding it or copying an entire example blindly.

### Current gap

Catalog item pages now have human requests and separated technical details. Discovery is still mostly category navigation; it needs better visual comparison and outcome-led filtering.

---

## What these journeys mean for the documentation structure

The current four top-level tabs can remain, but their purpose becomes stricter:

### Guides

Owns journeys 1, 2, 3, and 5:

- understand the product;
- make the first result;
- perform a creation workflow;
- solve a problem.

### Studio

Owns journey 4:

- review;
- edit;
- animate;
- export a project.

### Catalog

Owns journey 7:

- discover and reuse visuals.

### Developers

Owns journey 6:

- integrate;
- automate;
- extend;
- deploy;
- use technical reference.

Concepts, API details, changelogs, package pages, internal architecture, and contribution material remain useful only as supporting material. They should not interrupt primary journeys.

## Recommended visual production

### Video A — “What is HyperFrames?” (P0)

- 45–60 seconds.
- Made entirely with HyperFrames.
- Shows request → agent work → project → Studio edit → export.
- Must work muted with captions.
- Used on Introduction and externally in product conversations.

### Video B — “Make your first video” (P0)

- 75–90 seconds.
- One real example from source material to exported MP4.
- Chaptered and paired with written steps.
- Used on Quickstart.

### Video C — “Studio in 90 seconds” (P0)

- Real screen capture with designed callouts.
- Storyboard, Preview, canvas, timeline, Inspector, agent feedback, and export.
- Used on Studio.

### Inline task loops (P1)

- 6–12 seconds each.
- Trim, split, select, edit text, keyframe, add Catalog item, export.
- Silent, captioned, and paired with written instructions.

### Diagrams

1. Human product loop:

   `Source → agent → project → Studio → result`

2. Technical surfaces:

   `CLI / SDK / Player / packages / deployment`

3. Studio versus agent:

   `Visible direct edit → Studio`

   `Broader outcome or source change → agent`

All videos require captions and a written equivalent. Diagrams require meaningful text alternatives.

## Approval questions

Leadership should answer these before implementation:

1. Are journeys 1–5 the correct P0 journeys?
2. Is `/introduction` the one official “What is HyperFrames?” link?
3. Should `/workflows` become the canonical experienced-creator hub?
4. Should `/help` become the canonical recovery hub?
5. Is the Browser Playground a primary “try it now” path or a secondary exploration path?
6. Which AI environments are safe to name as first-class supported starting points?
7. Can we produce the three P0 videos now, and who approves their product claims?
8. What are the ten support questions most frequently answered manually?
9. Do search analytics or support logs show another journey that should replace one of these?
10. Should the developer journey stay a top-level tab even though the human audience is the priority?

## Evidence and design basis

- GOV.UK recommends identifying the most important journeys, mapping them one by one, and using them to find dead ends, confusion, and duplicated content: [Map and understand a user's whole problem](https://www.gov.uk/service-manual/design/map-a-users-whole-problem).
- GOV.UK defines experience maps as the sequence of what people do, think, and feel over time, which makes pain points and broken handoffs visible: [Creating an experience map](https://www.gov.uk/service-manual/user-research/creating-an-experience-map).
- Google frames useful documentation as the knowledge and skill someone needs for a task minus what they already know: [Audience](https://developers.google.com/tech-writing/one/audience).
- Diátaxis separates tutorials, how-to guides, reference, and explanation because they answer different user needs: [Diátaxis in five minutes](https://www.diataxis.fr/start-here/).
- Stripe quickstarts emphasize end-to-end samples, stepwise instructions, and direct launch paths rather than reference-first learning: [Stripe quickstart guides](https://docs.stripe.com/quickstarts).
- Mintlify treats navigation as information hierarchy whose purpose is helping people find what they need: [Mintlify navigation](https://mintlify.mintlify.dev/docs/organize/navigation).

## How to validate after approval

Before a complete rewrite, test low-fidelity versions with at least:

- two people who have never used HyperFrames;
- two people who understand it but have not created a project;
- two returning creators;
- one Studio-first reviewer;
- one developer or integrator;
- recent support cases.

Give each person a realistic prompt and only the canonical starting link. Do not explain the site while they test.

Measure:

- whether they choose the correct next step;
- whether they can describe HyperFrames accurately;
- whether they complete the intended task;
- where they hesitate, backtrack, search, or ask for help;
- which page they expected but could not find;
- time to first useful result.

The journey is approved by behavior, not only by whether the document sounds reasonable.
