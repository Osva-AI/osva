import { useLocation } from "react-router-dom";

import { shellPageLabelFromPath } from "../../lib/shell-location";
import type { ThemePreference } from "../../lib/theme-preference";
import { NavIconSidebarToggle } from "./nav-icons";
import { AccountMenu } from "./account-menu";
import { CreateMenu } from "./create-menu";
import { HelpMenu } from "./help-menu";
import { ThemeMenu } from "./theme-menu";

export function ShellHeader({
  sidebarCollapsed,
  isMobile,
  mobileNavOpen,
  mobileNavId,
  menuButtonRef,
  themePreference,
  themeMenuOpen,
  createMenuOpen,
  helpMenuOpen,
  accountMenuOpen,
  onSidebarToggle,
  onMobileMenuToggle,
  onThemeMenuToggle,
  onThemeMenuClose,
  onCreateMenuToggle,
  onCreateMenuClose,
  onHelpMenuToggle,
  onHelpMenuClose,
  onAccountMenuToggle,
  onAccountMenuClose,
  onWorkspaceChange,
}: {
  readonly sidebarCollapsed: boolean;
  readonly isMobile: boolean;
  readonly mobileNavOpen: boolean;
  readonly mobileNavId: string;
  readonly menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly themePreference: ThemePreference;
  readonly themeMenuOpen: boolean;
  readonly createMenuOpen: boolean;
  readonly helpMenuOpen: boolean;
  readonly accountMenuOpen: boolean;
  readonly onSidebarToggle: () => void;
  readonly onMobileMenuToggle: () => void;
  readonly onThemeMenuToggle: () => void;
  readonly onThemeMenuClose: () => void;
  readonly onCreateMenuToggle: () => void;
  readonly onCreateMenuClose: () => void;
  readonly onHelpMenuToggle: () => void;
  readonly onHelpMenuClose: () => void;
  readonly onAccountMenuToggle: () => void;
  readonly onAccountMenuClose: () => void;
  readonly onWorkspaceChange: (workspaceId: string) => void;
}) {
  const location = useLocation();
  const pageLabel = shellPageLabelFromPath(location.pathname);

  const collapseLabel = sidebarCollapsed
    ? "Expand navigation"
    : "Collapse navigation";

  return (
    <header className="shell-header">
      <div className="shell-header-left">
        {isMobile ? (
          <button
            ref={menuButtonRef}
            type="button"
            className="shell-header-icon-btn"
            aria-expanded={mobileNavOpen}
            aria-controls={mobileNavId}
            aria-label="Menu"
            onClick={onMobileMenuToggle}
          >
            <NavIconSidebarToggle className="shell-nav-icon" />
            <span className="shell-header-btn-label">Menu</span>
          </button>
        ) : (
          <button
            type="button"
            className="shell-header-icon-btn"
            aria-label={collapseLabel}
            aria-expanded={!sidebarCollapsed}
            onClick={onSidebarToggle}
          >
            <NavIconSidebarToggle className="shell-nav-icon" />
          </button>
        )}
        <span className="shell-header-divider" aria-hidden="true" />
        <nav className="shell-breadcrumb" aria-label="Location">
          <span className="shell-breadcrumb-muted">Workspace</span>
          <span className="shell-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <span className="shell-breadcrumb-current">{pageLabel}</span>
        </nav>
      </div>
      <div className="shell-header-right">
        <CreateMenu
          open={createMenuOpen}
          onToggle={() => {
            onThemeMenuClose();
            onHelpMenuClose();
            onAccountMenuClose();
            onCreateMenuToggle();
          }}
          onClose={onCreateMenuClose}
        />
        <HelpMenu
          open={helpMenuOpen}
          onToggle={() => {
            onThemeMenuClose();
            onCreateMenuClose();
            onAccountMenuClose();
            onHelpMenuToggle();
          }}
          onClose={onHelpMenuClose}
        />
        <ThemeMenu
          open={themeMenuOpen}
          preference={themePreference}
          onToggle={() => {
            onCreateMenuClose();
            onHelpMenuClose();
            onAccountMenuClose();
            onThemeMenuToggle();
          }}
          onClose={onThemeMenuClose}
          compactLabel={isMobile}
        />
        <AccountMenu
          open={accountMenuOpen}
          onToggle={() => {
            onThemeMenuClose();
            onCreateMenuClose();
            onHelpMenuClose();
            onAccountMenuToggle();
          }}
          onClose={onAccountMenuClose}
          onWorkspaceChange={onWorkspaceChange}
        />
      </div>
    </header>
  );
}
