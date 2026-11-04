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
  type ThemePreference,
} from "../../lib/theme-preference";
import { isWorkflowStudioBuilderPath } from "../../lib/workflow-builder-studio-routes";
import { SidebarNav } from "./sidebar-nav";
import { ShellHeader } from "./shell-header";
import { NavIconBrand } from "./nav-icons";

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

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

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
    setThemeMenuOpen(false);
    setCreateMenuOpen(false);
    setHelpMenuOpen(false);
    setAccountMenuOpen(false);
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
      "a.shell-nav-link, button.shell-nav-link, button.shell-nav-disclosure",
    );
    focusable?.focus();
  }, [mobileNavOpen]);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const workflowStudioBuilder = isWorkflowStudioBuilderPath(location.pathname);
  const effectiveSidebarCollapsed =
    workflowStudioBuilder && !isMobile ? true : sidebarCollapsed;

  const shellClassName = [
    "app-shell",
    effectiveSidebarCollapsed && !isMobile ? "sidebar-collapsed" : "",
    mobileNavOpen ? "mobile-nav-open" : "",
    workflowStudioBuilder ? "app-shell--workflow-studio" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const compactNav = effectiveSidebarCollapsed && !isMobile;

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

  const toggleSidebar = (): void => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      writeSidebarCollapsed(next);
      return next;
    });
  };

  const sidebarContent = (
    <>
      <div className="shell-brand-row">
        <div className="shell-brand">
          <span className="shell-brand-mark" aria-hidden="true">
            <NavIconBrand className="shell-brand-icon" />
          </span>
          {!compactNav ? (
            <div className="shell-brand-text">
              <div className="brand-title">OSVA</div>
              <div className="brand-subtitle">Agent platform</div>
            </div>
          ) : null}
        </div>
      </div>

      <SidebarNav
        compact={compactNav}
        onNavigate={isMobile ? closeMobileNav : undefined}
      />
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
        <ShellHeader
          sidebarCollapsed={effectiveSidebarCollapsed}
          isMobile={isMobile}
          mobileNavOpen={mobileNavOpen}
          mobileNavId={mobileNavId}
          menuButtonRef={menuButtonRef}
          themePreference={themePreference}
          themeMenuOpen={themeMenuOpen}
          createMenuOpen={createMenuOpen}
          helpMenuOpen={helpMenuOpen}
          accountMenuOpen={accountMenuOpen}
          onSidebarToggle={toggleSidebar}
          onMobileMenuToggle={() => {
            setMobileNavOpen((open) => !open);
          }}
          onThemeMenuToggle={() => {
            setThemeMenuOpen((open) => !open);
          }}
          onThemeMenuClose={() => {
            setThemeMenuOpen(false);
          }}
          onCreateMenuToggle={() => {
            setCreateMenuOpen((open) => !open);
          }}
          onCreateMenuClose={() => {
            setCreateMenuOpen(false);
          }}
          onHelpMenuToggle={() => {
            setHelpMenuOpen((open) => !open);
          }}
          onHelpMenuClose={() => {
            setHelpMenuOpen(false);
          }}
          onAccountMenuToggle={() => {
            setAccountMenuOpen((open) => !open);
          }}
          onAccountMenuClose={() => {
            setAccountMenuOpen(false);
          }}
          onWorkspaceChange={handleWorkspaceChange}
        />
        <main
          className={`main-panel shell-main-content${workflowStudioBuilder ? " shell-main-content--workflow-studio" : ""}`}
          id="main-content"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
