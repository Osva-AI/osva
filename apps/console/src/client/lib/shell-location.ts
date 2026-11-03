const SEGMENT_LABELS: Record<string, string> = {
  overview: "Home",
  agents: "Agents",
  workflows: "Workflows",
  activity: "Activity",
  testing: "Testing",
  models: "Models",
  tools: "Integrations",
  connectors: "Integrations",
  knowledge: "Knowledge",
  memory: "Memory",
  runs: "Agent runs",
  "workflow-runs": "Workflow runs",
  onboarding: "Guided setup",
  settings: "Settings",
  examples: "Examples",
  workspace: "Workspace",
  access: "Workspace access",
  security: "Security activity",
  new: "Create",
};

export interface ShellBreadcrumb {
  readonly section: string;
  readonly detail?: string;
}

export function shellPageLabelFromPath(pathname: string): string {
  if (pathname === "/overview" || pathname === "/") {
    return "Home";
  }
  if (pathname.startsWith("/agents/new")) {
    return "Agent Studio";
  }
  if (pathname.startsWith("/workflows/new")) {
    return "Workflow Studio";
  }
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
    return "Guided setup";
  }

  const breadcrumb = shellBreadcrumbFromPath(pathname);
  if (breadcrumb.detail !== undefined) {
    return breadcrumb.detail;
  }
  return breadcrumb.section;
}

export function shellBreadcrumbFromPath(pathname: string): ShellBreadcrumb {
  const segments = pathname.split("/").filter((part) => part.length > 0);
  if (segments.length === 0) {
    return { section: "Home" };
  }

  const first = segments[0] ?? "";
  const section =
    SEGMENT_LABELS[first] ??
    first.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  if (segments.length === 1) {
    return { section };
  }

  const second = segments[1] ?? "";
  if (second === "new") {
    if (first === "agents") {
      return { section: "Agents", detail: "Create agent" };
    }
    if (first === "workflows") {
      return { section: "Workflows", detail: "Create workflow" };
    }
    return { section, detail: "Create" };
  }

  if (segments.length >= 3 && second === "versions") {
    return { section, detail: "Version" };
  }

  const detailLabel = SEGMENT_LABELS[second];
  if (detailLabel !== undefined && segments.length === 2) {
    return { section, detail: detailLabel };
  }

  return { section };
}
