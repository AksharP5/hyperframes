# HyperFrames documentation rules

Before changing anything in `docs/`, read:

1. `../research/docs-refactor/PLAN.md`
2. `../research/docs-refactor/NOTES.md`
3. The complete body of every page you plan to change
4. The product source or tests that prove the behavior being documented

These rules are persistent and apply to every documentation session:

- Write for a smart general user first. Do not assume they are a developer.
- Explain what a person can accomplish before explaining implementation details.
- Prefer plain words, short examples, screenshots, and visible outcomes.
- Keep agent instructions copyable and specific.
- Put CLI, SDK, package, schema, deployment, and internals under **Developers**.
- Never infer product behavior from page titles or old docs. Verify it in current code.
- Do not preserve a page merely because it already exists. Merge, rewrite, redirect, or remove it when that improves the user journey.
- Do not publish empty, duplicated, outdated, or aspirational content as fact.
- A page should answer a real question or help complete a real task.
- Keep ordinary top-level groups inside each tab, with no nested `root`, `directory`, `expanded`, or drilldown behavior.
- Match the deployed main docs' sidebar rhythm: 14px medium group headings, square links, no horizontal group dividers, and a segmented vertical rail whose active segment follows the current page. Groups remain open and non-collapsible.
- Keep the Aspen sidebar aligned to the 56px header and disable its early scroll-fade mask.
- Keep Mintlify's right-side **On this page** behavior and styling unchanged.
- Keep Aspen's desktop header on one row: logo, tabs, search, compact GitHub link with its star count, Playground action, and theme toggle. Preserve the fixed-width star-count fallback so client-side navigation does not make the control blink or collapse.
- Keep the bottom-center agent input visually distinct from the page with its own surface, stronger border, and restrained shadow.
- Record important findings, uncertainties, and decisions in `../research/docs-refactor/NOTES.md`.
- Update progress and changed decisions in `../research/docs-refactor/PLAN.md`.

## Page standard

Most human-facing pages should contain:

1. What this lets you do
2. When to use it
3. A visual or concrete example
4. The shortest successful path
5. What should happen
6. Common problems
7. Useful next steps

Do not force this structure where it makes a page worse. Reference pages may stay reference-shaped.

## Component doctrine

One component per job. If two components on a page render the same list, delete one.

| The job | Use | Never use |
| --- | --- | --- |
| Choose between destinations | `CardGroup` + `Card`, max 2 columns, linking to the real page | An accordion, or cards pointing at anchors on the same page |
| Ordered instructions | `Steps` | A flow diagram that repeats the same steps |
| Parallel variants of one instruction (source type, OS, language) | `Tabs` | Repeating the whole block per variant |
| Compare attributes across items | A table | Prose paragraphs per item |
| Any media | `Frame` with a caption that says what it is | A bare `img` with no context |
| Genuinely out-of-band aside | One `Note`, `Tip`, or `Warning` per page | Stacked callouts, or a callout for ordinary prose |

**Accordions are not used.** They hide the thing the reader is choosing between, cost a click, break `Cmd+F` and printing, and render as grey bars. Long symptom or reference lists become visible `##` sections instead — they get anchors the support team can link directly, and they appear in the page contents.

**No diagram that restates adjacent prose.** A four-node flow beside a four-step list is the same content twice. Keep whichever is more useful and delete the other.

**Cards link to pages, never to anchors on the current page.** A card that scrolls the reader a short distance to the same words is the worst pattern in these docs; it has been removed twice.

**Two columns is the practical maximum** for anything containing text. Three columns in this content width hyphenates titles mid-word.

### Custom React components

Mintlify compiles `.jsx` / `.tsx` from `docs/snippets/`. Use one when a native component genuinely cannot express the idea — a scrubber, a comparison slider, a live player — not for styling.

- Named exports only: `export const Thing = () => ...`. Default exports do not work.
- `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `useContext`, `useReducer` are pre-injected; do not import React.
- **No third-party packages and no CDN scripts.** Browser built-ins only (`fetch`, `IntersectionObserver`, Canvas, `<video>`). This rules out importing `@hyperframes/player` as a package — embed a hosted composition in an `iframe` instead.
- A snippet cannot import another snippet. Keep each self-contained.
- **Declare everything inside the component.** Only the exported component survives
  compilation; module-level `const`s above it are dropped, so a constant defined
  outside arrives `undefined` at render. The component then throws inside React,
  the error boundary swallows it, and the page renders nothing at that position —
  with no console error to point at it. If a snippet renders blank, check this first.
- Client-side only: guard anything touching `window` and give every component a sensible first paint.
- Respect `prefers-reduced-motion`, give interactive elements a visible focus state, and never make a component the only route to information.

### Raw HTML gotchas

**Utility classes are rewritten, and unknown ones are dropped.** Mintlify moves
Tailwind classes into its own `mint-*` namespace during the build. Write utilities
for layout that the theme already uses (`flex`, `rounded-xl`, `border`) and do not
rely on anything exotic surviving. Anything load-bearing belongs in `custom.css`
under an `hf-` class — those pass through untouched.

**Every `<img>` is wrapped in the image-zoom component.** The real markup is
`span[data-rmiz] > span[data-rmiz-content] > picture.contents > img`, so a width
set on a surrounding `div` is absorbed and the image renders full width — which
silently pushes a side-by-side card's text out of view. Use the `.hf-peek` class,
which collapses that wrapper, or use a `<video>`: videos are not wrapped, which is
why the same card layout works with one.

Prose styles also add a 2em margin to media, which shows as a band inside any
wrapper with its own background. Zero it when the wrapper is the frame.

### Width and media

The content column is widened in `custom.css` — a measured 888px at a 1600px viewport, 1048px at 1920px, where it used to be stuck at 664px. There is no paragraph measure cap: these pages are built from lists, tables, cards, and code, so a whole guide contains roughly three `<p>` elements and capping them changed nothing. Add `className="hf-wide"` when a visual should escape any inherited measure.

## Verification

After navigation or MDX changes:

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH mint validate
PATH=/opt/homebrew/opt/node@20/bin:$PATH mint broken-links
```

Use Bun for repository work. Do not create a `pnpm-lock.yaml`.

## Freshness and ownership

- A product behavior page is owned by the team that owns the matching product surface.
- A package or API reference is owned by the package maintainer.
- Workflow pages are owned by the maintainer of the matching agent skill.
- When a feature changes, update its task guide, related troubleshooting entry, and screenshot in the same pull request.
- Treat screenshots as product claims. Replace them when labels, layout, or the demonstrated workflow changes materially.
- Review **Start here**, **Studio**, **Export**, and **Troubleshooting** at least once per release cycle.
- Review lower-traffic reference pages at least quarterly.
- Remove an unowned update feed instead of letting it become stale.
- Use search analytics and support questions to decide which missing task pages to add next.
