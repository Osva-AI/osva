import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunsPage } from "../src/client/routes/runs-page";
import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

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
  beforeEach(() => {
    setSelectedWorkspaceId("ws-1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders runs and supports status filtering", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?") && url.includes("status=RUNNING")) {
        return json({
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
        });
      }
      if (url.includes("/api/v1/runs?")) {
        return json({ runs: [] });
      }
      return undefined;
    });

    renderRunsPage();
    await waitFor(() => {
      expect(screen.getByText("No runs yet.")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "RUNNING");

    await waitFor(() => {
      expect(screen.getByTestId("agent-runs-history-list")).toBeTruthy();
    });
    const list = screen.getByTestId("agent-runs-history-list");
    expect(
      within(list)
        .getByRole("link", { name: /Running/i })
        .getAttribute("href"),
    ).toBe("/runs/run-1");
  });

  it("navigates cursor pages", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("cursor=cursor-1")) {
        return json({
          runs: [
            {
              id: "run-2",
              agentId: "agent-1",
              status: "SUCCEEDED",
              effectiveBindings: {
                agentVersionId: "av-1",
                modelProfileVersionBindings: {},
                toolVersionBindings: {},
              },
              input: {},
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/runs?")) {
        return json({
          runs: [
            {
              id: "run-1",
              agentId: "agent-1",
              status: "RUNNING",
              effectiveBindings: {
                agentVersionId: "av-1",
                modelProfileVersionBindings: {},
                toolVersionBindings: {},
              },
              input: {},
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          nextCursor: "cursor-1",
        });
      }
      return undefined;
    });

    renderRunsPage();
    await waitFor(() => {
      expect(screen.getByTestId("agent-runs-history-list")).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("agent-runs-history-list"))
          .getByRole("link", { name: /Succeeded/i })
          .getAttribute("href"),
      ).toBe("/runs/run-2");
    });
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("agent-runs-history-list"))
          .getByRole("link", { name: /Running/i })
          .getAttribute("href"),
      ).toBe("/runs/run-1");
    });
  });

  it("shows API error state", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      return undefined;
    });

    renderRunsPage();
    await waitFor(() => {
      expect(screen.getByText("Could not load agent runs")).toBeTruthy();
    });
  });
});
