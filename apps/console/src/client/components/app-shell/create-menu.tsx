import { useRef } from "react";
import { Link } from "react-router-dom";

import { useAuthContextQuery } from "../../hooks/use-auth-context";
import { roleCanWriteControlPlaneResources } from "../../lib/permissions";
import { ConsoleNavIcon, NavIconChevron, NavIconPlus } from "./nav-icons";
import { ShellPopover } from "./shell-popover";

export function CreateMenu({
  open,
  onToggle,
  onClose,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const agentTo = canWrite ? "/agents/new" : "/agents";
  const workflowTo = canWrite ? "/workflows/new" : "/workflows";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="shell-header-create-btn"
        aria-label="Create"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <NavIconPlus className="shell-nav-icon" />
        <span className="shell-header-create-label">Create</span>
      </button>
      <ShellPopover
        open={open}
        label="Create"
        anchorRef={anchorRef}
        onClose={onClose}
      >
        <div className="shell-popover-menu" role="menu" aria-label="Create">
          <Link
            className="shell-popover-item"
            role="menuitem"
            to={agentTo}
            onClick={onClose}
          >
            <ConsoleNavIcon navId="agents" className="shell-nav-icon" />
            <span className="shell-popover-item-text">
              <span>Create an agent</span>
              {!canWrite ? (
                <span className="shell-popover-item-meta">
                  View agents (read-only role)
                </span>
              ) : null}
            </span>
            <NavIconChevron className="shell-popover-item-trailing" />
          </Link>
          <Link
            className="shell-popover-item"
            role="menuitem"
            to={workflowTo}
            onClick={onClose}
          >
            <ConsoleNavIcon navId="workflows" className="shell-nav-icon" />
            <span className="shell-popover-item-text">
              <span>Build a workflow</span>
              {!canWrite ? (
                <span className="shell-popover-item-meta">
                  View workflows (read-only role)
                </span>
              ) : null}
            </span>
            <NavIconChevron className="shell-popover-item-trailing" />
          </Link>
        </div>
      </ShellPopover>
    </>
  );
}
