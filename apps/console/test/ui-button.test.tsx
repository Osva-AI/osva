import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { Button, LinkButton } from "../src/client/components/ui/button";

describe("Button", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders variants and loading state", () => {
    render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(
      "primary",
    );

    render(<Button loading>Working</Button>);
    expect(
      screen.getByRole("button", { name: "Working" }).getAttribute("aria-busy"),
    ).toBe("true");
  });

  it("renders link buttons with button styling", () => {
    render(
      <MemoryRouter>
        <LinkButton variant="secondary" to="/agents">
          Agents
        </LinkButton>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Agents" }).className).toContain(
      "button-secondary",
    );
  });
});
