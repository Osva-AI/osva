const STORAGE_KEY = "osva.console.sidebarCollapsed";

export function readSidebarCollapsed(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  if (collapsed) {
    localStorage.setItem(STORAGE_KEY, "1");
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
