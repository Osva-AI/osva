import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/button";

export function OnboardingRecoveryDialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="dialog-root">
      <div className="dialog-overlay" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="dialog-panel onboarding-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <p id={descriptionId} className="dialog-description">
          {description}
        </p>
        {children !== undefined ? (
          <div className="onboarding-recovery-dialog-body">{children}</div>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
