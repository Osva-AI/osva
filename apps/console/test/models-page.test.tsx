import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { ModelConnectionsPage } from "../src/client/routes/model-connections-page";
import { ModelsPage } from "../src/client/routes/models-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderModels(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/models" element={<ModelsPage />} />
            <Route
              path="/models/connections"
              element={<ModelConnectionsPage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModelsPage V2.7A", () => {
  it("shows read-only guidance for viewers and hides create form", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/api/v1/model-profiles") && method === "GET") {
        return json({ modelProfiles: [] });
      }
      if (
        url.includes("/api/v1/model-provider-connections") &&
        method === "GET"
      ) {
        return json({ connections: [] });
      }
      return undefined;
    });

    renderModels("/models");

    await waitFor(() => {
      expect(screen.getByTestId("models-v2-page")).toBeTruthy();
    });
    expect(screen.getByText(/Read-only access/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create profile" })).toBeNull();
  });

  it("separates connection summary from profiles for developers", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/api/v1/model-profiles") && method === "GET") {
        if (url.includes("/versions")) {
          return json({ versions: [] });
        }
        return json({
          modelProfiles: [
            {
              id: "mp-1",
              workspaceId: "ws-1",
              key: "primary",
              name: "Primary",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (
        url.includes("/api/v1/model-provider-connections") &&
        method === "GET"
      ) {
        return json({
          connections: [
            {
              id: "conn-1",
              workspaceId: "ws-1",
              key: "openai",
              name: "Workspace OpenAI",
              provider: "OPENAI",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    renderModels("/models");

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Workspace OpenAI" }),
      ).toBeTruthy();
    });
    expect(
      screen
        .getByRole("link", { name: "Workspace OpenAI" })
        .getAttribute("href"),
    ).toBe("/models/connections/conn-1");
    expect(
      screen.getByRole("link", { name: "Primary" }).getAttribute("href"),
    ).toBe("/models/mp-1");
    expect(screen.getByRole("button", { name: "Create profile" })).toBeTruthy();
  });
});
