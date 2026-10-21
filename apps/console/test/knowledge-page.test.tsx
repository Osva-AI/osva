import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { KnowledgePage } from "../src/client/routes/knowledge-page";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

describe("Knowledge UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders knowledge studio with empty sources", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/knowledge-sources")) {
        return Response.json({ items: [] });
      }
      if (url.includes("/api/v1/artifacts")) {
        return Response.json({ items: [] });
      }
      return new Response("not found", { status: 404 });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter>
            <KnowledgePage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Knowledge", level: 1 }),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/No knowledge sources yet/i)).toBeTruthy();
    });
  });
});
