import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import {
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../../lib/permissions";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "../../lib/sidebar-preference";
import {
  readThemePreference,
  subscribeToSystemColorScheme,
  syncThemeFromPreference,
  writeThemePreference,
  type ThemePreference,
} from "../../lib/theme-preference";
import { Button } from "../ui/button";
import { SidebarNav } from "./sidebar-nav";

const MOBILE_NAV_MEDIA = "(max-width: 900px)";

function subscribeToMobileNav(onStoreChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }
  const media = window.matchMedia(MOBILE_NAV_MEDIA);
  media.addEventListener("change", onStoreChange);
  return () => {
    media.removeEventListener("change", onStoreChange);
  };
}

function readMobileNavSnapshot(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(MOBILE_NAV_MEDIA).matches;
}

function subscribeToThemePreference(onStoreChange: () => void): () => void {
  const handler = (): void => {
    onStoreChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("osva-theme-preference", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("osva-theme-preference", handler);
  };
}

function readThemePreferenceSnapshot(): ThemePreference {
  return readThemePreference();
}

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = auth.selectedWorkspace;
  const role = workspace?.role;
  const mobileNavId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const isMobile = useSyncExternalStore(
    subscribeToMobileNav,
    readMobileNavSnapshot,
    () => false,
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readSidebarCollapsed(),
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const themePreference = useSyncExternalStore(
    subscribeToThemePreference,
    readThemePreferenceSnapshot,
    (): ThemePreference => "system",
  );

  useEffect(() => {
    syncThemeFromPreference(themePreference);
  }, [themePreference]);

  useEffect(() => subscribeToSystemColorScheme(() => undefined), []);

  useEffect(() => {
    if (!isMobile) {
      setMobileNavOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen || drawerRef.current === null) {
      return;
    }
    const focusable = drawerRef.current.querySelector<HTMLElement>(
      "a.shell-nav-link, button, select",
    );
    focusable?.focus();
  }, [mobileNavOpen]);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const shellClassName = [
    "app-shell",
    sidebarCollapsed && !isMobile ? "sidebar-collapsed" : "",
    mobileNavOpen ? "mobile-nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const compactNav = sidebarCollapsed && !isMobile;

  const handleWorkspaceChange = (workspaceId: string): void => {
    const nextWorkspace = auth.workspaces.find(
      (item) => item.workspaceId === workspaceId,
    );
    auth.selectWorkspace(workspaceId);
    const nextRole = nextWorkspace?.role;
    const path = location.pathname;
    if (
      path.startsWith("/workspace/access") &&
      nextRole !== undefined &&
      !roleCanManageMembers(nextRole)
    ) {
      navigate("/overview", { replace: true });
      return;
    }
    if (
      path.startsWith("/workspace/security") &&
      nextRole !== undefined &&
      !roleCanReadAuditEvents(nextRole)
    ) {
      navigate("/overview", { replace: true });
      return;
    }
    navigate(path, { replace: true });
  };

  const handleThemeChange = (value: ThemePreference): void => {
    writeThemePreference(value);
    syncThemeFromPreference(value);
    window.dispatchEvent(new Event("osva-theme-preference"));
  };

  const displayName =
    auth.user?.displayName?.trim() || auth.user?.email || "Signed-in user";
  const accountDetail =
    auth.user?.displayName?.trim() &&
    auth.user.email &&
    auth.user.displayName.trim() !== auth.user.email
      ? auth.user.email
      : undefined;

  const sidebarContent = (
    <>
      <div className="shell-brand-row">
        <div className="shell-brand">
          <div className="brand-title">OSVA</div>
          {!compactNav ? <div className="brand-subtitle">Console</div> : null}
        </div>
        {!isMobile ? (
          <Button
            type="button"
            variant="ghost"
            className="shell-collapse-toggle"
            aria-label={
              sidebarCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!sidebarCollapsed}
            onClick={() => {
              setSidebarCollapsed((previous) => {
                const next = !previous;
                writeSidebarCollapsed(next);
                return next;
              });
            }}
          >
            {sidebarCollapsed ? "»" : "«"}
          </Button>
        ) : null}
      </div>

      <div className="shell-workspace-block">
        {compactNav ? (
          <button
            type="button"
            className="button shell-workspace-compact"
            aria-label={`Current workspace: ${workspace?.name ?? "Unknown"}. Open sidebar to switch.`}
            title={workspace?.name}
            onClick={() => {
              setSidebarCollapsed(false);
              writeSidebarCollapsed(false);
            }}
          >
            <span className="shell-workspace-compact-mark" aria-hidden="true">
              {(workspace?.name ?? "W").slice(0, 1).toUpperCase()}
            </span>
          </button>
        ) : (
          <label className="shell-workspace-label">
            <span>Workspace</span>
            <select
              className="shell-workspace-select"
              aria-label="Workspace switcher"
              value={workspace?.workspaceId ?? ""}
              onChange={(event) => {
                handleWorkspaceChange(event.target.value);
              }}
            >
              {auth.workspaces.map((item) => (
                <option key={item.workspaceId} value={item.workspaceId}>
                  {item.name} · {formatRoleLabel(item.role)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <SidebarNav
        role={role}
        compact={compactNav}
        onNavigate={isMobile ? closeMobileNav : undefined}
      />

      <div className="shell-sidebar-footer">
        <div className="shell-account" aria-label="Account">
          <div className="shell-account-name">{displayName}</div>
          {!compactNav && accountDetail !== undefined ? (
            <div className="shell-account-email">{accountDetail}</div>
          ) : null}
          {!compactNav && role !== undefined ? (
            <div className="shell-account-role">{formatRoleLabel(role)}</div>
          ) : null}
        </div>

        {!compactNav ? (
          <label className="shell-theme-field">
            <span>Theme</span>
            <select
              className="shell-theme-select"
              aria-label="Theme preference"
              value={themePreference}
              onChange={(event) => {
                handleThemeChange(event.target.value as ThemePreference);
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          className="logout-button"
          aria-label="Sign out"
          onClick={() => {
            void auth.logout().finally(() => {
              navigate("/login", { replace: true });
            });
          }}
        >
          {compactNav ? "Out" : "Sign out"}
        </Button>
      </div>
    </>
  );

  return (
    <div className={shellClassName}>
      {!isMobile ? (
        <aside className="sidebar shell-sidebar" aria-label="Application">
          {sidebarContent}
        </aside>
      ) : (
        <>
          {mobileNavOpen ? (
            <button
              type="button"
              className="shell-nav-scrim"
              aria-label="Close navigation"
              onClick={closeMobileNav}
            />
          ) : null}
          <aside
            ref={drawerRef}
            id={mobileNavId}
            className="sidebar shell-sidebar shell-sidebar-drawer"
            aria-label="Application"
            aria-hidden={!mobileNavOpen}
            inert={mobileNavOpen ? undefined : true}
            data-open={mobileNavOpen ? "true" : "false"}
          >
            {sidebarContent}
          </aside>
        </>
      )}
      <div className="shell-main-wrap">
        {isMobile ? (
          <header className="shell-mobile-topbar">
            <Button
              ref={menuButtonRef}
              type="button"
              variant="secondary"
              className="shell-menu-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls={mobileNavId}
              onClick={() => {
                setMobileNavOpen((open) => !open);
              }}
            >
              Menu
            </Button>
            <div className="shell-mobile-brand">
              <span className="brand-title">OSVA Console</span>
            </div>
          </header>
        ) : null}
        <main className="main-panel" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
