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
- Keep Mintlify's right-side **On this page** behavior and styling unchanged.
- Keep Aspen's desktop header on one row: logo, tabs, search, actions, and theme toggle.
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
