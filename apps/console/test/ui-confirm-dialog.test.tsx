import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/client/components/ui/confirm-dialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("supports confirm, cancel, and escape dismissal", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Remove member"
        description="This cannot be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
