export interface ConsoleNavItem {
  readonly label: string;
  readonly to: string;
  /** When true, NavLink only matches the exact path (e.g. Home). */
  readonly end?: boolean;
  readonly navId: string;
}

export interface ConsoleNavSection {
  readonly title: string;
  readonly sectionId: string;
  readonly items: readonly ConsoleNavItem[];
}

export const CONSOLE_NAV_SECTIONS: readonly ConsoleNavSection[] = [
  {
    title: "Start",
    sectionId: "start",
    items: [
      { label: "Home", to: "/overview", end: true, navId: "home" },
      {
        label: "Getting started",
        to: "/onboarding",
        navId: "getting-started",
      },
    ],
  },
  {
    title: "Build",
    sectionId: "build",
    items: [
      { label: "Agents", to: "/agents", navId: "agents" },
      { label: "Workflows", to: "/workflows", navId: "workflows" },
    ],
  },
  {
    title: "Resources",
    sectionId: "resources",
    items: [
      { label: "Models", to: "/models", navId: "models" },
      {
        label: "Tools / Connectors",
        to: "/tools",
        navId: "tools",
      },
      { label: "Knowledge", to: "/knowledge", navId: "knowledge" },
      { label: "Memory", to: "/memory", navId: "memory" },
    ],
  },
  {
    title: "Operate",
    sectionId: "operate",
    items: [
      { label: "Runs", to: "/runs", navId: "runs" },
      {
        label: "Workflow Runs",
        to: "/workflow-runs",
        navId: "workflow-runs",
      },
      {
        label: "Testing Studio",
        to: "/testing",
        navId: "testing-studio",
      },
    ],
  },
];

export const WORKSPACE_NAV_ITEMS: readonly ConsoleNavItem[] = [
  {
    label: "Workspace Access",
    to: "/workspace/access",
    navId: "workspace-access",
  },
  {
    label: "Security Activity",
    to: "/workspace/security",
    navId: "security-activity",
  },
];
