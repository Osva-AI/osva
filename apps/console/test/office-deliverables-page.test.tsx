import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { OfficeDeliverablesPage } from "../src/client/routes/office-deliverables-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

const digest = `sha256:${"d".repeat(64)}`;

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/office/deliverables"]}>
          <Routes>
            <Route path="/office/deliverables" element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OfficeDeliverablesPage", () => {
  it("renders paginated workspace artifacts with task provenance", async () => {
    stubHumanSessionFetch("ADMIN", "ws-office", (url) => {
      const path = String(url);
      if (path === "/api/v1/office/assignments") {
        return json({
          items: [
            {
              id: "asn-1",
              workspaceId: "ws-office",
              officeWorkerId: "ow-1",
              title: "Write memo",
              targetType: "AGENT_VERSION",
              targetVersionId: "av-1",
              input: {},
              status: "COMPLETED",
              runId: "run-1",
              goalId: "goal-1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (path.includes("/api/v1/artifacts")) {
        return json({
          items: [
            {
              id: "art-1",
              name: "memo.md",
              mediaType: "text/markdown",
              sizeBytes: 42,
              digest,
              createdAt: "2026-01-02T00:00:00.000Z",
              producer: { runId: "run-1", runAttemptId: "ra-1" },
            },
          ],
        });
      }
      if (path === "/api/v1/office/goals") {
        return json({
          items: [
            {
              id: "goal-1",
              workspaceId: "ws-office",
              key: "memo",
              title: "Memo mission",
              status: "OPEN",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/v1/office/workers") {
        return json({
          items: [
            {
              id: "ow-1",
              workspaceId: "ws-office",
              key: "writer",
              name: "Writer",
              agentId: "agent-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return json({ items: [] });
    });

    wrap(<OfficeDeliverablesPage />);

    await waitFor(() => {
      expect(screen.getByText("memo.md")).toBeTruthy();
    });
    expect(screen.getAllByText("Write memo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Memo mission").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Filters apply to the current artifact page only/i),
    ).toBeTruthy();
  });
});
