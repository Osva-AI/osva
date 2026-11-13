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

export const HOME_NAV_ITEM: ConsoleNavItem = {
  label: "Home",
  to: "/overview",
  end: true,
  navId: "home",
};

export const BUILD_NAV_ITEMS: readonly ConsoleNavItem[] = [
  { label: "Agents", to: "/agents", navId: "agents" },
  { label: "Workflows", to: "/workflows", navId: "workflows" },
];

export const OFFICE_NAV_ITEMS: readonly ConsoleNavItem[] = [
  {
    label: "Mission Control",
    to: "/office",
    end: true,
    navId: "office-mission-control",
  },
  { label: "Missions", to: "/office/missions", navId: "office-missions" },
  { label: "Tasks", to: "/office/tasks", navId: "office-tasks" },
  {
    label: "Deliverables",
    to: "/office/deliverables",
    navId: "office-deliverables",
  },
  { label: "Team Chat", to: "/office/chat", navId: "office-chat" },
  { label: "Inbox", to: "/office/inbox", navId: "office-inbox" },
  { label: "Teams", to: "/office/teams", navId: "office-teams" },
  { label: "Workers", to: "/office/workers", navId: "office-workers" },
];

export const MANAGE_NAV_ITEMS: readonly ConsoleNavItem[] = [
  { label: "Activity", to: "/activity", navId: "activity" },
  { label: "Testing", to: "/testing", navId: "testing" },
];

export const RESOURCES_NAV_ITEMS: readonly ConsoleNavItem[] = [
  { label: "Models", to: "/models", navId: "models" },
  { label: "Integrations", to: "/tools", navId: "tools" },
  { label: "Knowledge", to: "/knowledge", navId: "knowledge" },
  { label: "Memory", to: "/memory", navId: "memory" },
];

export const FOOTER_NAV_ITEMS: readonly ConsoleNavItem[] = [
  { label: "Settings", to: "/settings", navId: "settings" },
];

/** @deprecated Use section-specific exports; kept for tests migrating off M18 sections. */
export const CONSOLE_NAV_SECTIONS: readonly ConsoleNavSection[] = [
  {
    title: "Start",
    sectionId: "start",
    items: [HOME_NAV_ITEM],
  },
  {
    title: "Build",
    sectionId: "build",
    items: BUILD_NAV_ITEMS,
  },
  {
    title: "Manage",
    sectionId: "manage",
    items: MANAGE_NAV_ITEMS,
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

const RESOURCE_PATH_PREFIXES = [
  "/models",
  "/tools",
  "/connectors",
  "/knowledge",
  "/memory",
] as const;

export function isResourcesRoute(pathname: string): boolean {
  return RESOURCE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isOfficeRoute(pathname: string): boolean {
  return pathname === "/office" || pathname.startsWith("/office/");
}

export function isActivityRoute(pathname: string): boolean {
  return (
    pathname === "/activity" ||
    pathname.startsWith("/runs") ||
    pathname.startsWith("/workflow-runs")
  );
}

export function isSettingsRoute(pathname: string): boolean {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/workspace/access") ||
    pathname.startsWith("/workspace/security")
  );
}

export function navItemMatchesPath(
  item: ConsoleNavItem,
  pathname: string,
): boolean {
  if (item.navId === "activity") {
    return isActivityRoute(pathname);
  }
  if (item.navId === "settings") {
    return isSettingsRoute(pathname);
  }
  if (item.end === true) {
    return pathname === item.to;
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function resourceNavItemMatchesPath(
  item: ConsoleNavItem,
  pathname: string,
): boolean {
  if (item.navId === "tools") {
    return (
      pathname === "/tools" ||
      pathname.startsWith("/tools/") ||
      pathname === "/connectors" ||
      pathname.startsWith("/connectors/")
    );
  }
  return navItemMatchesPath(item, pathname);
}
