import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluationRunLaunchPage } from "../src/client/routes/evaluation-run-launch-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderLaunchPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/testing/runs/new"]}>
        <EvaluationRunLaunchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubLaunchCatalog(
  extra?: (url: string, init?: RequestInit) => Response | undefined,
) {
  stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
    if ((init?.method ?? "GET") !== "GET") {
      return extra?.(url, init);
    }
    if (
      url.includes("/api/v1/evaluation-suites") &&
      url.includes("/versions")
    ) {
      return json({
        items: [
          {
            id: "esv-1",
            evaluationSuiteId: "es-1",
            version: 1,
            cases: [
              {
                id: "case-1",
                evaluationSuiteVersionId: "esv-1",
                key: "case-1",
                input: {},
                evaluator: {
                  type: "JSON_EXACT_MATCH",
                  expected: {},
                },
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    if (url.includes("/api/v1/evaluation-suites")) {
      return json({
        items: [
          {
            id: "es-1",
            workspaceId: "ws-1",
            key: "suite",
            name: "Suite",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    if (url.includes("/api/v1/agents") && url.includes("/versions")) {
      return json({
        versions: [
          {
            id: "av-1",
            agentId: "agent-1",
            version: 1,
            status: "PUBLISHED",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    if (url.includes("/api/v1/agents")) {
      return json({
        agents: [
          {
            id: "agent-1",
            workspaceId: "ws-1",
            key: "agent",
            name: "Agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    return extra?.(url, init);
  });
}

describe("EvaluationRunLaunchPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not show field validation errors before launch is attempted", async () => {
    stubLaunchCatalog();
    renderLaunchPage();
    await waitFor(() => {
      expect(screen.getByTestId("evaluation-launch-page")).toBeTruthy();
    });
    expect(screen.queryByText(/Select an evaluation suite/i)).toBeNull();
  });

  it("shows field validation errors after launch is attempted", async () => {
    const user = userEvent.setup();
    stubLaunchCatalog();
    renderLaunchPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/Evaluation suite/i)).toBeTruthy();
    });

    await user.selectOptions(
      screen.getByLabelText(/Evaluation suite/i),
      "es-1",
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/Published version/i)).toBeTruthy();
    });
    await user.selectOptions(
      screen.getByLabelText(/Published version/i),
      "esv-1",
    );
    await user.selectOptions(screen.getByLabelText(/^Agent$/i), "agent-1");
    await user.click(screen.getByRole("button", { name: "Launch evaluation" }));

    await waitFor(() => {
      expect(screen.getByText(/Select an AgentVersion/i)).toBeTruthy();
    });
  });
});
