import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { TestingStudioPage } from "../src/client/routes/testing-studio-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderTestingStudio() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/testing"]}>
          <TestingStudioPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Testing Studio V2.7E", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders hub with playground link for M13.7.2 smoke compatibility", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/evaluation-suites")) {
        return json({ items: [] });
      }
      if (url.includes("/api/v1/evaluation-runs")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderTestingStudio();
    await waitFor(() => {
      expect(screen.getByTestId("testing-v2-page")).toBeTruthy();
    });
    expect(
      screen.getByRole("link", { name: "Open Agent playground" }),
    ).toBeTruthy();
  });

  it("shows execute restriction for VIEWER", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/evaluation-suites")) {
        return json({ items: [] });
      }
      if (url.includes("/api/v1/evaluation-runs")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderTestingStudio();
    await waitFor(() => {
      expect(screen.getByText(/Execute access required/i)).toBeTruthy();
    });
    expect(
      screen.queryByRole("link", { name: "Launch evaluation" }),
    ).toBeNull();
  });
});
