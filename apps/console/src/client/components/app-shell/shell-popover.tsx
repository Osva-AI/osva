import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ShellPopoverProps {
  readonly open: boolean;
  readonly label: string;
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly align?: "end" | "start";
}

export function ShellPopover({
  open,
  label,
  anchorRef,
  onClose,
  children,
  align = "end",
}: ShellPopoverProps) {
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
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();

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

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (panel?.contains(target)) {
        return;
      }
      if (anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      lastFocusedRef.current?.focus();
    };
  }, [anchorRef, onClose, open]);

  useEffect(() => {
    if (!open || anchorRef.current === null || panelRef.current === null) {
      return;
    }
    const anchor = anchorRef.current.getBoundingClientRect();
    const panel = panelRef.current;
    const top = anchor.bottom + 8;
    panel.style.top = `${top}px`;
    if (align === "end") {
      panel.style.right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
      panel.style.left = "auto";
    } else {
      panel.style.left = `${Math.max(8, anchor.left)}px`;
      panel.style.right = "auto";
    }
  }, [align, anchorRef, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className="shell-popover"
      role="dialog"
      aria-labelledby={titleId}
      aria-label={label}
    >
      <span id={titleId} className="visually-hidden">
        {label}
      </span>
      {children}
    </div>,
    document.body,
  );
}
