import { useRef } from "react";

import {
  type ThemePreference,
  writeThemePreference,
  syncThemeFromPreference,
} from "../../lib/theme-preference";
import { ShellPopover } from "./shell-popover";
import { NavIconTheme } from "./nav-icons";

const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeMenu({
  open,
  preference,
  onToggle,
  onClose,
  compactLabel,
}: {
  readonly open: boolean;
  readonly preference: ThemePreference;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly compactLabel?: boolean;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  const apply = (value: ThemePreference): void => {
    writeThemePreference(value);
    syncThemeFromPreference(value);
    window.dispatchEvent(new Event("osva-theme-preference"));
    onClose();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="shell-header-icon-btn"
        aria-label="Theme"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <NavIconTheme className="shell-nav-icon" />
        {compactLabel ? (
          <span className="shell-header-btn-label">Theme</span>
        ) : null}
      </button>
      <ShellPopover
        open={open}
        label="Appearance"
        anchorRef={anchorRef}
        onClose={onClose}
      >
        <div className="shell-popover-section">
          <div className="shell-popover-heading">Appearance</div>
          <div
            className="shell-theme-options"
            role="radiogroup"
            aria-label="Theme preference"
          >
            {OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preference === option.value}
                className={
                  preference === option.value
                    ? "shell-popover-item active"
                    : "shell-popover-item"
                }
                onClick={() => {
                  apply(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </ShellPopover>
    </>
  );
}
