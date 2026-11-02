import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "./button";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
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
    const confirmButton = panel?.querySelector<HTMLElement>(
      '[data-confirm-dialog="confirm"]',
    );
    confirmButton?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [open, onCancel, pending]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="dialog-root">
      <div
        className="dialog-overlay"
        aria-hidden="true"
        onClick={() => {
          if (!destructive && !pending) {
            onCancel();
          }
        }}
      />
      <div
        ref={panelRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <p id={descriptionId} className="dialog-description">
          {description}
        </p>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
            data-confirm-dialog="cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            loading={pending}
            onClick={onConfirm}
            data-confirm-dialog="confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
