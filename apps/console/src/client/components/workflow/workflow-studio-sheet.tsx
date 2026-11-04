import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/button";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WorkflowStudioSheet({
  open,
  title,
  ariaLabel,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title?: string;
  readonly ariaLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        return;
      }
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="workflow-studio-sheet" role="presentation">
      <button
        type="button"
        className="workflow-studio-sheet-scrim"
        aria-label="Close panel"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="workflow-studio-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
      >
        {title !== undefined ? (
          <h3 id={titleId} className="workflow-studio-sheet-title">
            {title}
          </h3>
        ) : null}
        {children}
        <div className="workflow-studio-sheet-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
