import { NavLink } from "react-router-dom";

import {
  CONSOLE_NAV_SECTIONS,
  WORKSPACE_NAV_ITEMS,
  type ConsoleNavItem,
  type ConsoleNavSection,
} from "../../lib/console-navigation";
import {
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../../lib/permissions";
import { ConsoleNavIcon } from "./nav-icons";

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
  onNavigate,
}: {
  readonly item: ConsoleNavItem;
  readonly compact: boolean;
  readonly onNavigate?: () => void;
}) {
  return (
    <li>
      <NavLink
        className={({ isActive }) => navLinkClassName(isActive, compact)}
        to={item.to}
        end={item.end === true}
        title={compact ? item.label : undefined}
        aria-label={compact ? item.label : undefined}
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

function ShellNavSectionBlock({
  section,
  compact,
  onNavigate,
}: {
  readonly section: ConsoleNavSection;
  readonly compact: boolean;
  readonly onNavigate?: () => void;
}) {
  return (
    <div className="nav-section" data-section={section.sectionId}>
      {!compact ? (
        <div className="nav-section-title">{section.title}</div>
      ) : (
        <div className="nav-section-title visually-hidden">{section.title}</div>
      )}
      <ul className="nav-list">
        {section.items.map((item) => (
          <ShellNavItem
            key={item.navId}
            item={item}
            compact={compact}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

export function SidebarNav({
  role,
  compact,
  onNavigate,
}: {
  readonly role: string | undefined;
  readonly compact: boolean;
  readonly onNavigate?: () => void;
}) {
  const workspaceItems = WORKSPACE_NAV_ITEMS.filter((item) => {
    if (role === undefined) {
      return false;
    }
    if (item.navId === "workspace-access") {
      return roleCanManageMembers(role);
    }
    if (item.navId === "security-activity") {
      return roleCanReadAuditEvents(role);
    }
    return false;
  });

  return (
    <nav aria-label="Primary" className="shell-primary-nav">
      {CONSOLE_NAV_SECTIONS.map((section) => (
        <ShellNavSectionBlock
          key={section.sectionId}
          section={section}
          compact={compact}
          onNavigate={onNavigate}
        />
      ))}
      {workspaceItems.length > 0 ? (
        <div className="nav-section" data-section="workspace">
          {!compact ? (
            <div className="nav-section-title">Workspace</div>
          ) : (
            <div className="nav-section-title visually-hidden">Workspace</div>
          )}
          <ul className="nav-list">
            {workspaceItems.map((item) => (
              <ShellNavItem
                key={item.navId}
                item={item}
                compact={compact}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
