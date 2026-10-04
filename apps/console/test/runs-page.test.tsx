import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunsPage } from "../src/client/routes/runs-page";

function renderRunsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RunsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders runs and supports status filtering", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("status=RUNNING")) {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: "run-1",
                agentId: "agent-1",
                status: "RUNNING",
                effectiveBindings: {
                  agentVersionId: "agent-version-1",
                  modelProfileVersionBindings: {},
                  toolVersionBindings: {},
                },
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRunsPage();
    await waitFor(() => {
      expect(screen.getByText("No runs yet.")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "RUNNING");

    await waitFor(() => {
      expect(screen.getByText("run-1")).toBeTruthy();
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("status=RUNNING"),
      ),
    ).toBe(true);
  });
});
