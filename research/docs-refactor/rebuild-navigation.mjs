import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const configPath = resolve(root, "docs/docs.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const currentCatalog = config.navigation.tabs.find((item) => item.tab === "Catalog");
if (!currentCatalog) {
  throw new Error("Could not find the Catalog tab in docs/docs.json");
}

const catalogGroups =
  currentCatalog.groups?.length === 1 && currentCatalog.groups[0].group === "Catalog"
    ? currentCatalog.groups[0].pages
    : currentCatalog.groups;

if (!Array.isArray(catalogGroups) || catalogGroups.length === 0) {
  throw new Error("Could not recover the existing Catalog groups");
}

const collapsedCatalogGroups = catalogGroups.map((group) => ({
  ...group,
  pages:
    group.group === "Effects" && !group.pages.includes("catalog/components/motion-blur")
      ? [...group.pages, "catalog/components/motion-blur"]
      : group.pages,
  expanded: false,
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

config.interaction = {
  drilldown: false,
};

config.navigation = {
  tabs: [
    {
      tab: "Guides",
      icon: "book-open",
      pages: [
        "guides/index",
            {
              group: "Start here",
              root: "introduction",
              expanded: true,
              pages: [
                "quickstart",
                "guides/choose-your-path",
                "guides/project-tour",
                "guides/authentication",
                "guides/mcp",
              ],
            },
            {
              group: "Create with an agent",
              root: "guides/create-with-agent",
              expanded: false,
              pages: [
                "guides/skills",
                {
                  group: "Workflows",
                  expanded: false,
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
          group: "Learn",
              root: "concepts/index",
              expanded: false,
              pages: [
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
              root: "guides/media",
              expanded: false,
              pages: [
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
              root: "guides/export-and-share",
              expanded: false,
              pages: [
                "guides/quality-checklist",
                "guides/publish-and-share",
                "guides/rendering",
                "guides/4k-rendering",
                "guides/hdr",
                "guides/performance",
              ],
            },
            "examples",
            {
              group: "Help",
              root: "guides/help",
              expanded: false,
              pages: ["guides/common-questions", "guides/troubleshooting", "guides/feedback"],
            },
            {
              group: "What's new",
              root: "product-updates",
              expanded: false,
              pages: ["weekly-updates", "changelog"],
            },
      ],
    },
    {
      tab: "Studio",
      icon: "palette",
      pages: [
        "studio/index",
            "studio/tour",
            {
              group: "Review",
              expanded: true,
              pages: ["studio/storyboard"],
            },
            {
              group: "Edit",
              expanded: false,
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
              expanded: false,
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
              expanded: false,
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
      pages: [
        "catalog/index",
        ...collapsedCatalogGroups,
      ],
    },
    {
      tab: "Developers",
      icon: "code",
      pages: [
        "developers/index",
            {
              group: "Command line",
              expanded: true,
              pages: ["developers/cli", "packages/cli", "packages/lint"],
            },
            {
              group: "SDK",
              expanded: false,
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
              expanded: false,
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
              expanded: false,
              pages: ["reference/html-schema", "guides/gsap-animation", "guides/keyframes"],
            },
            {
              group: "Deployment",
              expanded: false,
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
              expanded: false,
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
