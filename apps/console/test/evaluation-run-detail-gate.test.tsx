import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluationRunDetailResource } from "../src/client/hooks/use-evaluations";
import { EvaluationRunDetailPage } from "../src/client/routes/evaluation-run-detail-page";

const baseSummary = {
  totalCases: 1,
  pendingCases: 0,
  runningCases: 0,
  completedCases: 1,
  passedCases: 1,
  failedCases: 0,
  errorCases: 0,
  passRate: 1,
  completionCoverage: 1,
  validScoredCaseCount: 1,
  inputTokens: 10,
  outputTokens: 5,
  pricedCostUsdMicros: 1000,
  unpricedModelCalls: 0,
  usageMeasured: true,
};

let mockRun: EvaluationRunDetailResource;
let mockCaseResultsLoading = false;
let mockCaseResultsError = false;

vi.mock("../src/client/hooks/use-evaluations", () => ({
  useEvaluationRunQuery: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: mockRun,
    refetch: vi.fn(),
  }),
  useEvaluationCaseResultsQuery: () => ({
    isLoading: mockCaseResultsLoading,
    isError: mockCaseResultsError,
    isFetching: false,
    data: mockCaseResultsLoading
      ? undefined
      : {
          items: [
            {
              id: "cr-1",
              evaluationRunId: "er-1",
              evaluationCaseId: "case-1",
              runId: "run-1",
              outcome: "PASS",
              evaluatorResults: {},
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
    error: mockCaseResultsError ? new Error("case results failed") : undefined,
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
        cases: [
          {
            id: "case-1",
            evaluationSuiteVersionId: "esv-1",
            key: "case-1",
            input: {},
            evaluator: { type: "JSON_EXACT_MATCH", expected: {} },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    refetch: vi.fn(),
  }),
}));

function renderPage() {
  const queryClient = new QueryClient();
  return render(
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
}

function baseRun(
  overrides: Partial<EvaluationRunDetailResource> = {},
): EvaluationRunDetailResource {
  return {
    id: "er-1",
    workspaceId: "ws-1",
    evaluationSuiteVersionId: "esv-1",
    targetType: "AGENT_VERSION",
    targetVersionId: "av-1",
    status: "COMPLETED",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:01.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    summary: { ...baseSummary },
    ...overrides,
  };
}

describe("EvaluationRunDetailPage quality gate UI", () => {
  beforeEach(() => {
    mockCaseResultsLoading = false;
    mockCaseResultsError = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows ungated evaluation copy", () => {
    mockRun = baseRun();
    renderPage();
    expect(screen.getByText("No quality gate configured.")).toBeTruthy();
  });

  it("shows gate PASS verdict", () => {
    mockRun = baseRun({
      qualityGate: {
        policy: {
          schemaVersion: 1,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 0.5 }],
        },
        assessment: {
          schemaVersion: 1,
          overallVerdict: "PASS",
          lifecycleVerdict: "PASS",
          assessedAt: "2026-01-01T00:00:10.000Z",
          ruleResults: [
            {
              metric: "PASS_RATE",
              operator: "MIN",
              threshold: 0.5,
              observedValue: 1,
              verdict: "PASS",
              reasonCode: "THRESHOLD_SATISFIED",
            },
          ],
        },
      },
    });
    renderPage();
    expect(screen.getByText("Gate verdict")).toBeTruthy();
    expect(screen.getAllByText("Pass").length).toBeGreaterThan(0);
  });

  it("shows gate FAIL while run status stays COMPLETED", () => {
    mockRun = baseRun({
      status: "COMPLETED",
      qualityGate: {
        policy: {
          schemaVersion: 1,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }],
        },
        assessment: {
          schemaVersion: 1,
          overallVerdict: "FAIL",
          lifecycleVerdict: "PASS",
          assessedAt: "2026-01-01T00:00:10.000Z",
          ruleResults: [
            {
              metric: "PASS_RATE",
              operator: "MIN",
              threshold: 1,
              observedValue: 0.5,
              verdict: "FAIL",
              reasonCode: "THRESHOLD_VIOLATED",
            },
          ],
        },
      },
    });
    renderPage();
    const runStatus = screen
      .getAllByRole("heading", { name: "Run status" })[0]!
      .closest("section")!;
    expect(within(runStatus).getByText("COMPLETED")).toBeTruthy();
    expect(screen.getAllByText("Fail").length).toBeGreaterThan(0);
  });

  it("shows INDETERMINATE rule explanation", () => {
    mockRun = baseRun({
      summary: { ...baseSummary, qualityScore: undefined },
      qualityGate: {
        policy: {
          schemaVersion: 1,
          rules: [{ metric: "QUALITY_SCORE", operator: "MIN", threshold: 0.5 }],
        },
        assessment: {
          schemaVersion: 1,
          overallVerdict: "INDETERMINATE",
          lifecycleVerdict: "PASS",
          assessedAt: "2026-01-01T00:00:10.000Z",
          ruleResults: [
            {
              metric: "QUALITY_SCORE",
              operator: "MIN",
              threshold: 0.5,
              verdict: "INDETERMINATE",
              reasonCode: "MISSING_EVIDENCE",
            },
          ],
        },
      },
    });
    renderPage();
    expect(
      screen.getByText(/Required evidence is not available yet/),
    ).toBeTruthy();
  });

  it("shows running preview without final pass messaging", () => {
    mockRun = baseRun({
      status: "RUNNING",
      summary: {
        ...baseSummary,
        runningCases: 1,
        completedCases: 0,
      },
      qualityGate: {
        policy: {
          schemaVersion: 1,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }],
        },
        assessment: {
          schemaVersion: 1,
          overallVerdict: "INDETERMINATE",
          lifecycleVerdict: "INDETERMINATE",
          assessedAt: "2026-01-01T00:00:02.000Z",
          ruleResults: [],
        },
      },
    });
    renderPage();
    expect(screen.getByText(/Preview metrics only/)).toBeTruthy();
  });

  it("shows missing quality score as em dash", () => {
    mockRun = baseRun({
      summary: { ...baseSummary, qualityScore: undefined },
    });
    renderPage();
    const aggregate = screen
      .getAllByRole("heading", { name: "Aggregate results" })[0]!
      .closest("section")!;
    expect(within(aggregate).getByText("—")).toBeTruthy();
  });

  it("warns on unpriced model calls", () => {
    mockRun = baseRun({
      summary: {
        ...baseSummary,
        unpricedModelCalls: 2,
        usageMeasured: true,
      },
    });
    renderPage();
    expect(screen.getByText(/lack pricing/)).toBeTruthy();
  });

  it("still renders case results table", () => {
    mockRun = baseRun();
    renderPage();
    expect(
      screen.getAllByRole("columnheader", { name: "Case" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("case-1").length).toBeGreaterThan(0);
  });

  it("shows loading state for case results", () => {
    mockRun = baseRun();
    mockCaseResultsLoading = true;
    renderPage();
    expect(screen.getByText("Loading case results…")).toBeTruthy();
  });

  it("shows API error for case results", () => {
    mockRun = baseRun();
    mockCaseResultsError = true;
    renderPage();
    expect(screen.getByText("Failed to load case results")).toBeTruthy();
  });
});
