import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TestingStudioPage } from "../src/client/routes/testing-studio-page";

vi.mock("../src/client/hooks/use-evaluations", () => ({
  useEvaluationSuitesQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: { items: [] },
    refetch: vi.fn(),
  }),
  useEvaluationRunsListQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: { items: [] },
    refetch: vi.fn(),
  }),
}));

describe("TestingStudioPage", () => {
  it("renders the testing studio landing sections", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TestingStudioPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Testing Studio", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Evaluation suites" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Recent evaluation runs" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open Agent playground" })
        .getAttribute("href"),
    ).toBe("/testing/playground");
  });
});
