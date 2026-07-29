# Documentation visual production briefs

Status: **Ready for production**

The written journeys are complete without these assets. These videos and loops are the next improvement: they should reduce explanation time, not decorate pages.

## Shared rules

- Build the videos with HyperFrames so the documentation proves the product through its own output.
- Use real product states and honest claims.
- Every video must work muted.
- Include captions and a written equivalent.
- Avoid rapid UI montage that looks impressive but teaches nothing.
- Show the cursor only when its action matters.
- Keep interface text readable at the final embedded size.
- End on the next action the page asks the viewer to take.

## P0-A — What is HyperFrames?

**Placement:** `/introduction`, above the first major section  
**Duration:** 45–60 seconds  
**Job:** replace the five-minute verbal product explanation

### Story

1. A person starts with a plain-language request and real source.
2. The agent confirms the creative direction.
3. The agent builds a real HyperFrames project.
4. The project opens in Studio.
5. A person makes one visible direct edit.
6. The person asks the agent for one broader revision.
7. Studio exports the result.
8. The finished video plays.

### Required message

> An agent creates the first real project. A person reviews and edits it in Studio. HyperFrames exports the result.

### Avoid

- opening with HTML, packages, or rendering architecture;
- presenting Studio as a separate product;
- implying that every project begins from a website;
- showing only a finished montage without the creation loop.

## P0-B — Make your first video

**Placement:** `/quickstart`, after the opening outcome  
**Duration:** 75–90 seconds  
**Job:** show the shortest complete first-use path

### Story

Use one realistic product URL:

1. install the HyperFrames guidance;
2. send the request;
3. review the returned brief;
4. approve it;
5. show the build at a useful level without waiting through every operation;
6. open Studio;
7. watch the complete first version;
8. make one direct edit;
9. ask for one broader revision;
10. export MP4 and play the file.

### On-screen progress

`Request → Brief → Build → Review → Export`

### Avoid

- treating installation as the conclusion;
- using a fake example domain in the final recording;
- hiding the creative approval step;
- cutting before the exported file is visibly played.

## P0-C — Studio in 90 seconds

**Placement:** `/studio`, after the opening description  
**Duration:** 60–90 seconds  
**Job:** orient someone opening an agent-created project

### Story

1. Open an existing project.
2. Explain Storyboard versus Preview.
3. Play the complete result.
4. Select a visible element.
5. Change its text or design.
6. Adjust one clip on the timeline.
7. Show one animation control.
8. copy one broader feedback message to the agent;
9. run the project check;
10. export a named version.

### Required message

> If you can point at the thing, start in Studio. If you need a broader outcome, ask the agent.

## P1 task loops

Each loop should be 6–12 seconds, silent, captioned, and tightly cropped around one task.

| Loop                         | Placement          | Visible success                       |
| ---------------------------- | ------------------ | ------------------------------------- |
| Select and edit text         | Canvas             | Updated text remains selected         |
| Trim a clip                  | Timeline           | New clip edge and changed playback    |
| Split at the playhead        | Timeline           | Two clips appear                      |
| Add a keyframe               | Animation          | Diamond appears and movement previews |
| Add a Catalog item           | Assets and Catalog | Item appears in the project           |
| Fix caption timing           | Captions           | Words align with speech               |
| Save and copy agent feedback | Storyboard         | Useful message reaches clipboard      |
| Export MP4                   | Export             | Finished file appears in the queue    |

## Static diagrams

Already implemented in the docs:

- source → agent → project → Studio → result;
- first-video progress;
- Studio versus agent decision;
- developer surface chooser.

Before replacing a diagram with motion, test whether motion makes the relationship easier to understand. Keep the static version as the accessible text equivalent.

## Production approval

Before publishing each video, confirm:

- product controls and names match the current release;
- source material can be shown publicly;
- claims are supported;
- no private paths, tokens, account information, or notifications appear;
- captions match the final voice or on-screen text;
- the embedded poster makes sense before playback;
- the page still works when the video is unavailable.
