# HyperFrames docs: user journeys for approval

Status: **Decision draft**

## The decision

We should stop treating the docs as a collection of pages and design them around the situations in which people actually need help.

The recommendation is to make these five journeys the P0 documentation product:

| Person's situation                                             | One link we send      | What that page must achieve                                                              |
| -------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| “I have no idea what HyperFrames is.”                          | `/introduction`       | Explain the product in under a minute, prove it visually, and offer the right next step. |
| “I understand it. I want to make my first video.”              | `/quickstart`         | Take the person from their source material to a reviewable video in Studio.              |
| “I know HyperFrames. I need to make a specific kind of thing.” | `/workflows` proposed | Help them choose the correct workflow and give the agent a useful starting request.      |
| “An agent made a project. I need to review or change it.”      | `/studio`             | Help them understand the workspace, make a visible change, and export safely.            |
| “Something is broken and I need to get unstuck.”               | `/help` proposed      | Start from the visible symptom, fix it, and return them to their original task.          |

Two secondary journeys remain important:

- `/developers` — integrate, automate, embed, extend, or deploy HyperFrames.
- `/catalog` — find, add, and adapt an existing visual.

## What changes if this is approved

Every important journey gets:

- one canonical link that teammates can confidently send;
- an opening screen that immediately confirms the person's situation;
- visible proof before technical explanation;
- one clear route through the task;
- a specific success state;
- no unrelated concepts interrupting the path.

Navigation, page order, videos, diagrams, examples, redirects, and content removal will derive from these journeys.

## The three P0 visual assets

1. **What is HyperFrames?** — a 45–60 second video showing request → agent → project → Studio edit → export.
2. **Make your first video** — a 75–90 second real walkthrough from source material to MP4.
3. **Studio in 90 seconds** — a real screen recording explaining the workspace and one complete edit.

Each must work muted, include captions, and have an equivalent written path. Short 6–12 second loops can later demonstrate individual tasks such as trimming, changing text, keyframing, and exporting.

## Approval needed

Please approve or change:

1. Are these the correct five P0 journeys?
2. Is `/introduction` our official link for “What is HyperFrames?”
3. Should `/workflows` be the main returning-creator hub?
4. Should `/help` be the main recovery hub?
5. Is the browser Playground a primary try-it-now path or a secondary showcase?
6. Which AI environments can we describe as first-class supported paths?
7. Can we produce the three P0 videos, and who approves their product claims?
8. What are the ten support questions the team answers most often?

## Recommended next move

Approve the journeys and URLs first. Then prototype only the first screen and path for `/introduction`, `/quickstart`, and `/workflows`. Test each by giving a realistic person only that one link. Begin the full rewrite after those tests show that people understand the product and reach the intended result.

The detailed journeys, page sequences, success tests, current gaps, research basis, and validation plan are in `USER-JOURNEYS-PROPOSAL.md`.
