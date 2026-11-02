import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { OverviewPage } from "../src/client/routes/overview-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

describe("OverviewPage route (/overview Home)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("redirects / to Home", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents")) {
        return json({ agents: [] });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      return undefined;
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/overview" element={<OverviewPage />} />
              </Route>
              <Route path="/" element={<Navigate to="/overview" replace />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Home", level: 1 }),
      ).toBeTruthy();
    });
  });
});
