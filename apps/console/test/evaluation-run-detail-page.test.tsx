import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { EVALUATION_RUN_USAGE_PENDING_LABEL } from "../src/client/lib/evaluation-run-usage-display";
import { EvaluationRunDetailPage } from "../src/client/routes/evaluation-run-detail-page";

const evaluationRunDetail = {
  id: "er-1",
  workspaceId: "ws-1",
  evaluationSuiteVersionId: "esv-1",
  targetType: "AGENT_VERSION",
  targetVersionId: "av-1",
  status: "COMPLETED",
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:01.000Z",
  completedAt: "2026-01-01T00:00:05.000Z",
  summary: {
    totalCases: 1,
    pendingCases: 0,
    runningCases: 0,
    completedCases: 1,
    passedCases: 1,
    failedCases: 0,
    errorCases: 0,
    passRate: 1,
    inputTokens: 0,
    outputTokens: 0,
    pricedCostUsdMicros: 0,
    unpricedModelCalls: 0,
  },
};

vi.mock("../src/client/hooks/use-evaluations", () => ({
  useEvaluationRunQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: evaluationRunDetail,
    refetch: vi.fn(),
  }),
  useEvaluationCaseResultsQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: { items: [] },
    refetch: vi.fn(),
  }),
  useResolvedEvaluationSuiteVersionQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: {
      suite: {
        id: "es-1",
        workspaceId: "ws-1",
        key: "suite",
        name: "Suite",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      version: {
        id: "esv-1",
        evaluationSuiteId: "es-1",
        version: 1,
        cases: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    refetch: vi.fn(),
  }),
}));

describe("EvaluationRunDetailPage usage metrics", () => {
  it("does not present placeholder zeros as verified token usage", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/testing/runs/er-1"]}>
          <Routes>
            <Route
              path="/testing/runs/:evaluationRunId"
              element={<EvaluationRunDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getAllByText(EVALUATION_RUN_USAGE_PENDING_LABEL).length,
    ).toBeGreaterThanOrEqual(1);
    const aggregateSection = screen.getByRole("heading", {
      name: "Aggregate results",
    }).parentElement;
    expect(aggregateSection?.textContent).not.toMatch(
      /Input tokens[\s\S]*\b0\b/,
    );
  });
});
