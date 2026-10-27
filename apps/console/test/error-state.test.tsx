import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorState } from "../src/client/components/error-state/error-state";
import { ConsoleApiError } from "../src/client/lib/console-api";

describe("ErrorState", () => {
  it("renders operator guidance for rate-limited API errors with alert role", () => {
    render(
      <ErrorState
        title="Request failed"
        error={
          new ConsoleApiError(429, {
            error: "Control plane rate limit exceeded. Wait before retrying.",
          })
        }
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });
});
