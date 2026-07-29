# Journey implementation map

Status: **Approved and in implementation**

This map prevents individual page edits from drifting away from the approved end-to-end journeys.

## P0 journeys

| Journey                             | Canonical route | Entry promise                                                       | Primary supporting pages                                                    | Success state                                                                        |
| ----------------------------------- | --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Understand HyperFrames from zero    | `/introduction` | Understand the product in under a minute and see proof              | Examples, Quickstart, Studio                                                | Person can explain the agent → project → Studio → result loop and choose a next step |
| Make a first real video             | `/quickstart`   | Reach a reviewable result, not merely complete setup                | Workflows, Prompting, Studio tour, Export                                   | Video plays in Studio or an exported file exists                                     |
| Start a specific creation workflow  | `/workflows`    | Choose by source and outcome without knowing internal skill names   | Focused workflow pages, Prompting, Studio                                   | Correct workflow starts with a sufficiently useful request                           |
| Review and edit an existing project | `/studio`       | Understand the workspace, make the right type of change, and export | Storyboard, Tour, Canvas, Timeline, Animation, Export                       | Person makes a visible change or exports a version                                   |
| Recover when something is wrong     | `/help`         | Start from the symptom and return to the interrupted task           | Common questions, general troubleshooting, Studio troubleshooting, Feedback | Person fixes the problem or produces a useful diagnostic                             |

## Consolidation decisions

- `/guides/create-with-agent` is replaced by `/workflows`.
- `/guides/choose-your-path` is replaced by `/workflows`.
- `/guides/help` is replaced by `/help`.
- Old routes redirect so existing support messages and external links do not break.
- `/guides` remains a concise task router. It is not the canonical product explanation.
- `/introduction` remains the one link to send when somebody asks what HyperFrames is.

## Cross-link contract

Every P0 entry route must:

1. confirm the person's situation in the opening screen;
2. describe the result they will reach;
3. keep the main path visible before secondary detail;
4. link forward to the next task;
5. link to `/help` where the task can fail;
6. avoid requiring repository or framework architecture knowledge.

Supporting pages should return people to the journey they came from instead of ending in unrelated reference material.

## Visual contract

Available now:

- finished production video on Introduction;
- product-loop and task-progress diagrams;
- real Studio workspace imagery;
- Studio-versus-agent decision diagram;
- copyable requests based on realistic source material.

Production assets still required:

- 45–60 second “What is HyperFrames?” product-loop video;
- 75–90 second first-video walkthrough;
- 60–90 second real Studio tour;
- 6–12 second task loops for trim, split, text editing, keyframes, Catalog insertion, and export.

Until those assets are produced, existing real videos, screenshots, diagrams, and written equivalents must keep every journey complete.

## Removal rule

A page should be merged, hidden, or removed when it:

- duplicates a canonical entry route;
- supports no approved journey, real support question, or required reference;
- introduces internal terminology before the task requires it;
- ends without helping the person return to a task.
