import { useRef } from "react";
import { Link } from "react-router-dom";

import { NavIconHelp, NavIconSparkles } from "./nav-icons";
import { ShellPopover } from "./shell-popover";

export function HelpMenu({
  open,
  onToggle,
  onClose,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="shell-header-icon-btn"
        aria-label="Help"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <NavIconHelp className="shell-nav-icon" />
      </button>
      <ShellPopover
        open={open}
        label="Help and guidance"
        anchorRef={anchorRef}
        onClose={onClose}
      >
        <div className="shell-popover-section">
          <div className="shell-popover-account-head">
            <div>
              <div className="shell-popover-name">Help & guidance</div>
              <div className="shell-popover-email">
                Assistance for your current task
              </div>
            </div>
          </div>
          <div className="shell-popover-divider" />
          <Link
            className="shell-popover-item"
            to="/onboarding"
            onClick={onClose}
          >
            <NavIconSparkles className="shell-nav-icon" />
            <span className="shell-popover-item-text">
              <span>Guided setup</span>
              <span className="shell-popover-item-meta">
                Step-by-step first agent path
              </span>
            </span>
          </Link>
        </div>
      </ShellPopover>
    </>
  );
}
