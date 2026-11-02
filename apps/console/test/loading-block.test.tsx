import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingBlock } from "../src/client/components/loading/loading-block";

describe("LoadingBlock", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes a polite status region", () => {
    render(<LoadingBlock label="Loading agents…" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading agents…");
  });
});
