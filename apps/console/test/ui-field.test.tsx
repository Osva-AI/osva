import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TextField } from "../src/client/components/ui/field";

describe("TextField", () => {
  afterEach(() => {
    cleanup();
  });

  it("associates labels, hints, and errors accessibly", () => {
    render(
      <TextField
        id="agent-key"
        label="Agent key"
        hint="Lowercase identifier."
        error="Key is required."
        value=""
        readOnly
      />,
    );

    const input = screen.getByLabelText("Agent key");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("agent-key-error");
    expect(screen.getByRole("alert").textContent).toContain("Key is required.");
  });
});
