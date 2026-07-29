import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const configPath = resolve(root, "docs/docs.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const currentCatalog = config.navigation.tabs.find((item) => item.tab === "Catalog");
if (!currentCatalog) {
  throw new Error("Could not find the Catalog tab in docs/docs.json");
}

const catalogGroups = currentCatalog.groups?.filter((group) => group.group !== "Overview");

if (!Array.isArray(catalogGroups) || catalogGroups.length === 0) {
  throw new Error("Could not recover the existing Catalog groups");
}

const completeCatalogGroups = catalogGroups.map((group) => ({
  ...group,
  pages:
    group.group === "Effects" && !group.pages.includes("catalog/components/motion-blur")
      ? [...group.pages, "catalog/components/motion-blur"]
      : group.pages,
}));

config.appearance = {
  default: "system",
};

config.logo = {
  light: "/logo/light.svg",
  dark: "/logo/dark.svg",
  href: "https://hyperframes.heygen.com/introduction",
};

config.navbar = {
  links: [
    {
      type: "github",
      href: "https://github.com/heygen-com/hyperframes",
    },
  ],
  primary: {
    type: "button",
    label: "Playground",
    href: "https://www.hyperframes.dev/",
  },
};

delete config.interaction;

config.navigation = {
  tabs: [
    {
      tab: "Guides",
      icon: "book-open",
      groups: [
        {
          group: "Start here",
          pages: [
            "guides/index",
            "introduction",
            "quickstart",
            "guides/choose-your-path",
            "guides/project-tour",
            "guides/authentication",
            "guides/mcp",
          ],
        },
        {
          group: "Create with an agent",
          pages: [
            "guides/create-with-agent",
            "guides/skills",
            "guides/prompting",
            "guides/pipeline",
            "guides/design-tools",
            "guides/claude-design-hyperframes",
            "guides/claude-design-send-to-hyperframes",
            "guides/open-design-hyperframes",
            "guides/figma",
            "guides/antigravity",
            "guides/copilot-cli",
          ],
        },
        {
          group: "Workflows",
          pages: [
            "guides/product-launch-video",
            "guides/faceless-explainer",
            "guides/pr-to-video",
            "guides/captions-and-recuts",
            "guides/motion-graphics",
            "guides/music-to-video",
            "guides/general-video",
          ],
        },
        {
          group: "Learn",
          pages: [
            "concepts/index",
            "concepts/compositions",
            "concepts/variables",
            "concepts/data-attributes",
            "concepts/frame-adapters",
            "concepts/determinism",
            "guides/html-in-canvas",
            "guides/hyperframes-vs-remotion",
          ],
        },
        {
          group: "Media",
          pages: [
            "guides/media",
            "guides/video-components",
            "guides/voice-and-audio",
            "guides/transcribe-and-caption",
            "guides/remove-background",
            "guides/color-grading",
            "guides/media-effects",
            "guides/media-overlays",
          ],
        },
        {
          group: "Export and share",
          pages: [
            "guides/export-and-share",
            "guides/quality-checklist",
            "guides/publish-and-share",
            "guides/rendering",
            "guides/4k-rendering",
            "guides/hdr",
            "guides/performance",
          ],
        },
        {
          group: "Examples",
          pages: ["examples"],
        },
        {
          group: "Help",
          pages: [
            "guides/help",
            "guides/common-questions",
            "guides/troubleshooting",
            "guides/feedback",
          ],
        },
        {
          group: "What's new",
          pages: ["product-updates", "weekly-updates", "changelog"],
        },
      ],
    },
    {
      tab: "Studio",
      icon: "palette",
      groups: [
        {
          group: "Overview",
          pages: ["studio/index", "studio/tour"],
        },
        {
          group: "Review",
          pages: ["studio/storyboard"],
        },
        {
          group: "Edit",
          pages: [
            "studio/canvas",
            "studio/layers",
            "studio/timeline",
            "studio/design",
            "studio/animation",
          ],
        },
        {
          group: "Build",
          pages: [
            "studio/assets-and-blocks",
            "studio/captions",
            "studio/variables",
            "studio/slideshows",
            "studio/source",
          ],
        },
        {
          group: "Finish",
          pages: [
            "studio/lint-and-agent",
            "studio/export",
            "studio/shortcuts",
            "studio/troubleshooting",
          ],
        },
      ],
    },
    {
      tab: "Catalog",
      icon: "grid-2",
      groups: [
        {
          group: "Overview",
          pages: ["catalog/index"],
        },
        ...completeCatalogGroups,
      ],
    },
    {
      tab: "Developers",
      icon: "code",
      groups: [
        {
          group: "Overview",
          pages: ["developers/index"],
        },
        {
          group: "Command line",
          pages: ["developers/cli", "packages/cli", "packages/lint"],
        },
        {
          group: "SDK",
          pages: [
            "sdk/overview",
            "sdk/quickstart",
            "sdk/guides/querying-and-editing",
            "sdk/guides/timing-and-animation",
            "sdk/guides/undo-redo-and-patches",
            "sdk/guides/persistence",
            "sdk/guides/embedded-override-mode",
            "sdk/guides/canvas-integration",
            "sdk/guides/editing-affordances",
            "sdk/reference/open-composition",
            "sdk/reference/composition",
            "sdk/reference/edit-operations",
            "sdk/reference/types",
            "sdk/reference/adapters",
            "sdk/reference/utilities",
          ],
        },
        {
          group: "Packages",
          pages: [
            "packages/core",
            "packages/parsers",
            "packages/studio-server",
            "packages/sdk",
            "packages/engine",
            "packages/player",
            "packages/producer",
            "packages/shader-transitions",
            "packages/studio",
          ],
        },
        {
          group: "Schema and animation",
          pages: ["reference/html-schema", "guides/gsap-animation", "guides/keyframes"],
        },
        {
          group: "Deployment",
          pages: [
            "deploy/cloud",
            "guides/deploy",
            "deploy/aws-lambda",
            "deploy/gcp-cloud-run",
            "deploy/templates-on-lambda",
            "deploy/migrating-to-hyperframes-lambda",
            "packages/aws-lambda",
            "packages/gcp-cloud-run",
          ],
        },
        {
          group: "Contributing",
          pages: [
            "contributing",
            "contributing/catalog",
            "contributing/release-channels",
            "contributing/changelog-process",
            "contributing/testing-local-changes",
            "community/adopters",
          ],
        },
      ],
    },
  ],
};

config.redirects = [
  {
    source: "/showcase",
    destination: "/examples",
  },
  {
    source: "/launch-videos",
    destination: "/examples",
  },
  {
    source: "/guides/claude-design",
    destination: "/guides/design-tools",
  },
  {
    source: "/guides/open-design",
    destination: "/guides/design-tools",
  },
  {
    source: "/guides/common-mistakes",
    destination: "/guides/troubleshooting",
  },
  {
    source: "/contributing/studio-manual-dom-editing",
    destination: "/studio/canvas",
  },
  {
    source: "/guides/video-editor-cheatsheet",
    destination: "/studio/shortcuts",
  },
  {
    source: "/guides/timeline-editing",
    destination: "/studio/timeline",
  },
  {
    source: "/guides/website-to-video",
    destination: "/guides/product-launch-video",
  },
  {
    source: "/weekly-updates",
    destination: "/changelog",
  },
];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
