import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import {
  BUILD_NAV_ITEMS,
  FOOTER_NAV_ITEMS,
  HOME_NAV_ITEM,
  MANAGE_NAV_ITEMS,
  RESOURCES_NAV_ITEMS,
  isResourcesRoute,
  navItemMatchesPath,
  resourceNavItemMatchesPath,
  type ConsoleNavItem,
} from "../../lib/console-navigation";
import { ConsoleNavIcon, NavIconChevron, NavIconResources } from "./nav-icons";

function navLinkClassName(isActive: boolean, compact: boolean): string {
  const parts = ["shell-nav-link"];
  if (isActive) {
    parts.push("active");
  }
  if (compact) {
    parts.push("compact");
  }
  return parts.join(" ");
}

function ShellNavItem({
  item,
  compact,
  isActive,
  onNavigate,
  sub = false,
}: {
  readonly item: ConsoleNavItem;
  readonly compact: boolean;
  readonly isActive: boolean;
  readonly onNavigate?: () => void;
  readonly sub?: boolean;
}) {
  return (
    <li>
      <NavLink
        className={navLinkClassName(isActive, compact)}
        to={item.to}
        end={item.end === true}
        title={compact ? item.label : undefined}
        aria-label={compact ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        data-sub={sub ? "true" : undefined}
        onClick={() => {
          onNavigate?.();
        }}
      >
        <ConsoleNavIcon navId={item.navId} className="shell-nav-icon" />
        <span className="shell-nav-label">{item.label}</span>
      </NavLink>
    </li>
  );
}

function ResourcesFlyout({
  open,
  compact,
  pathname,
  onNavigate,
  onClose,
  anchorRef,
}: {
  readonly open: boolean;
  readonly compact: boolean;
  readonly pathname: string;
  readonly onNavigate?: () => void;
  readonly onClose: () => void;
  readonly anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const flyoutId = useId();

  useEffect(() => {
    if (!open || !compact) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, compact, onClose, open]);

  useEffect(() => {
    if (
      !open ||
      !compact ||
      anchorRef.current === null ||
      panelRef.current === null
    ) {
      return;
    }
    const anchor = anchorRef.current.getBoundingClientRect();
    panelRef.current.style.top = `${anchor.top}px`;
    panelRef.current.style.left = `${anchor.right + 8}px`;
  }, [anchorRef, compact, open]);

  if (!open || !compact) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      id={flyoutId}
      className="shell-resources-flyout"
      role="navigation"
      aria-label="Resources"
    >
      <ul className="nav-list">
        {RESOURCES_NAV_ITEMS.map((item) => (
          <ShellNavItem
            key={item.navId}
            item={item}
            compact={false}
            isActive={resourceNavItemMatchesPath(item, pathname)}
            onNavigate={() => {
              onNavigate?.();
              onClose();
            }}
            sub
          />
        ))}
      </ul>
    </div>
  );
}

export function SidebarNav({
  compact,
  onNavigate,
}: {
  readonly compact: boolean;
  readonly onNavigate?: () => void;
}) {
  const location = useLocation();
  const pathname = location.pathname;
  const resourcesActive = isResourcesRoute(pathname);
  const [resourcesOpen, setResourcesOpen] = useState(resourcesActive);
  const resourcesButtonRef = useRef<HTMLButtonElement>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  useEffect(() => {
    if (resourcesActive) {
      setResourcesOpen(true);
    }
  }, [resourcesActive]);

  useEffect(() => {
    if (!compact) {
      setFlyoutOpen(false);
    }
  }, [compact]);

  const toggleResources = (): void => {
    if (compact) {
      setFlyoutOpen((previous) => !previous);
      return;
    }
    setResourcesOpen((previous) => !previous);
  };

  return (
    <nav aria-label="Primary" className="shell-primary-nav">
      <div className="nav-section" data-section="start">
        <ul className="nav-list">
          <ShellNavItem
            item={HOME_NAV_ITEM}
            compact={compact}
            isActive={navItemMatchesPath(HOME_NAV_ITEM, pathname)}
            onNavigate={onNavigate}
          />
        </ul>
      </div>

      <div className="nav-section" data-section="build">
        {!compact ? (
          <div className="nav-section-title">Build</div>
        ) : (
          <div className="nav-section-title visually-hidden">Build</div>
        )}
        <ul className="nav-list">
          {BUILD_NAV_ITEMS.map((item) => (
            <ShellNavItem
              key={item.navId}
              item={item}
              compact={compact}
              isActive={navItemMatchesPath(item, pathname)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>

      <div className="nav-section" data-section="manage">
        {!compact ? (
          <div className="nav-section-title">Manage</div>
        ) : (
          <div className="nav-section-title visually-hidden">Manage</div>
        )}
        <ul className="nav-list">
          {MANAGE_NAV_ITEMS.map((item) => (
            <ShellNavItem
              key={item.navId}
              item={item}
              compact={compact}
              isActive={navItemMatchesPath(item, pathname)}
              onNavigate={onNavigate}
            />
          ))}
          <li>
            <button
              ref={resourcesButtonRef}
              type="button"
              className={
                resourcesActive
                  ? "shell-nav-link shell-nav-disclosure active"
                  : "shell-nav-link shell-nav-disclosure"
              }
              data-compact={compact ? "true" : undefined}
              aria-expanded={compact ? flyoutOpen : resourcesOpen}
              aria-controls="shell-resources-panel"
              aria-label={compact ? "Resources" : undefined}
              title={compact ? "Resources" : undefined}
              onClick={toggleResources}
            >
              <NavIconResources className="shell-nav-icon" />
              <span className="shell-nav-label">Resources</span>
              {!compact ? (
                <NavIconChevron
                  className={`shell-nav-chevron ${resourcesOpen ? "open" : ""}`}
                />
              ) : null}
            </button>
          </li>
          {!compact && resourcesOpen ? (
            <li className="shell-resources-group">
              <ul
                className="nav-list shell-resources-sublist"
                id="shell-resources-panel"
              >
                {RESOURCES_NAV_ITEMS.map((item) => (
                  <ShellNavItem
                    key={item.navId}
                    item={item}
                    compact={compact}
                    isActive={resourceNavItemMatchesPath(item, pathname)}
                    onNavigate={onNavigate}
                    sub
                  />
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      </div>

      <ResourcesFlyout
        open={flyoutOpen}
        compact={compact}
        pathname={pathname}
        onNavigate={onNavigate}
        onClose={() => {
          setFlyoutOpen(false);
        }}
        anchorRef={resourcesButtonRef}
      />

      <div className="shell-sidebar-footer-nav">
        <ul className="nav-list">
          {FOOTER_NAV_ITEMS.map((item) => (
            <ShellNavItem
              key={item.navId}
              item={item}
              compact={compact}
              isActive={navItemMatchesPath(item, pathname)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}
