import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import {
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../../lib/permissions";
import { WORKSPACE_NAV_ITEMS } from "../../lib/console-navigation";
import { ShellPopover } from "./shell-popover";
import { NavIconSignOut, NavIconWorkspace } from "./nav-icons";

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function avatarInitials(
  displayName: string,
  email: string | undefined,
): string {
  const trimmed = displayName.trim();
  if (trimmed.length >= 2) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  if (email !== undefined && email.length >= 2) {
    return email.slice(0, 2).toUpperCase();
  }
  return "U";
}

export function AccountMenu({
  open,
  onToggle,
  onClose,
  onWorkspaceChange,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onWorkspaceChange: (workspaceId: string) => void;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  const workspace = auth.selectedWorkspace;
  const role = workspace?.role;
  const displayName =
    auth.user?.displayName?.trim() || auth.user?.email || "Signed-in user";
  const email =
    auth.user?.email && auth.user.email !== displayName
      ? auth.user.email
      : undefined;

  const settingsLinks = WORKSPACE_NAV_ITEMS.filter((item) => {
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

  const closeAll = (): void => {
    setWorkspacePickerOpen(false);
    onClose();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="shell-account-avatar"
        aria-label="Account and workspace"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        {avatarInitials(displayName, auth.user?.email)}
      </button>
      <ShellPopover
        open={open}
        label="Account and workspace"
        anchorRef={anchorRef}
        onClose={closeAll}
      >
        {workspacePickerOpen ? (
          <div className="shell-popover-section">
            <button
              type="button"
              className="shell-popover-item"
              onClick={() => {
                setWorkspacePickerOpen(false);
              }}
            >
              Back to account
            </button>
            <div className="shell-popover-heading">Your workspaces</div>
            <ul className="shell-popover-list">
              {auth.workspaces.map((item) => {
                const selected = item.workspaceId === workspace?.workspaceId;
                return (
                  <li key={item.workspaceId}>
                    <button
                      type="button"
                      className={
                        selected
                          ? "shell-popover-item workspace active"
                          : "shell-popover-item workspace"
                      }
                      onClick={() => {
                        onWorkspaceChange(item.workspaceId);
                        setWorkspacePickerOpen(false);
                        closeAll();
                      }}
                    >
                      <NavIconWorkspace className="shell-nav-icon" />
                      <span className="shell-popover-item-text">
                        <strong>{item.name}</strong>
                        <span className="shell-popover-item-meta">
                          {formatRoleLabel(item.role)}
                          {selected ? " · Current" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <>
            <div className="shell-popover-account-head">
              <span className="shell-account-avatar large" aria-hidden="true">
                {avatarInitials(displayName, auth.user?.email)}
              </span>
              <div>
                <div className="shell-popover-name">{displayName}</div>
                {email !== undefined ? (
                  <div className="shell-popover-email">{email}</div>
                ) : null}
              </div>
            </div>
            <div className="shell-popover-divider" />
            <div className="shell-popover-heading">Active workspace</div>
            <button
              type="button"
              className="shell-popover-item workspace"
              onClick={() => {
                if (auth.workspaces.length > 1) {
                  setWorkspacePickerOpen(true);
                }
              }}
            >
              <NavIconWorkspace className="shell-nav-icon" />
              <span className="shell-popover-item-text">
                <strong>{workspace?.name ?? "Unknown workspace"}</strong>
                <span className="shell-popover-item-meta">
                  {role !== undefined ? formatRoleLabel(role) : "Role unknown"}
                  {auth.workspaces.length > 1 ? " · Switch" : ""}
                </span>
              </span>
            </button>
            <div className="shell-popover-divider" />
            <button
              type="button"
              className="shell-popover-item"
              onClick={() => {
                closeAll();
                navigate("/settings");
              }}
            >
              Workspace settings
            </button>
            {settingsLinks.map((item) => (
              <button
                key={item.navId}
                type="button"
                className="shell-popover-item"
                onClick={() => {
                  closeAll();
                  navigate(item.to);
                }}
              >
                {item.label}
              </button>
            ))}
            <div className="shell-popover-divider" />
            <button
              type="button"
              className="shell-popover-item signout"
              onClick={() => {
                closeAll();
                void auth.logout().finally(() => {
                  navigate("/login", { replace: true });
                });
              }}
            >
              <NavIconSignOut className="shell-nav-icon" />
              Sign out
            </button>
          </>
        )}
      </ShellPopover>
    </>
  );
}
