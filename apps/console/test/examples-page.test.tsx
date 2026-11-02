import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { ExampleDetailPage } from "../src/client/routes/example-detail-page";
import { ExamplesPage } from "../src/client/routes/examples-page";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderExamples(initialPath = "/examples") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/examples" element={<ExamplesPage />} />
              <Route
                path="/examples/:exampleId"
                element={<ExampleDetailPage />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Examples catalog routes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists curated examples and filters by search params", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderExamples("/examples?q=seo");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Examples", level: 1 }),
      ).toBeTruthy();
    });
    expect(screen.getByText("SEO audit worker")).toBeTruthy();
  });

  it("shows example detail with verification labels and external readme link", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1");
    renderExamples("/examples/04-seo-worker");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "SEO audit worker", level: 1 }),
      ).toBeTruthy();
    });
    expect(screen.getByText("Source documented")).toBeTruthy();
    expect(screen.getByText("Offline CI / smoke")).toBeTruthy();
    const readme = screen.getByRole("link", { name: "Open example README" });
    expect(readme.getAttribute("href")).toContain("osva-examples");
    expect(readme.getAttribute("target")).toBe("_blank");
    expect(
      screen.queryByRole("link", { name: "Open Agent Studio" }),
    ).toBeNull();
  });

  it("shows not-found for unknown example ids", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderExamples("/examples/not-in-catalog");

    await waitFor(() => {
      expect(screen.getByText("Example not found")).toBeTruthy();
    });
    expect(screen.getByText(/not in the curated catalog/i)).toBeTruthy();
  });

  it("ignores malformed filter params and still lists examples", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderExamples("/examples?category=invalid&complexity=bogus&q=");

    await waitFor(() => {
      expect(screen.getByText("Minimal agent run")).toBeTruthy();
    });
    expect(screen.getByText("SEO audit worker")).toBeTruthy();
  });

  it("does not show live integration verified badges", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderExamples("/examples/19-research-report-agent");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Research & Report agent",
          level: 1,
        }),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Live integration verified")).toBeNull();
    expect(screen.getByText("Live run is manual")).toBeTruthy();
  });

  it("supports keyboard submit on browse search form", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderExamples("/examples");
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("searchbox")).toBeTruthy();
    });
    const input = screen.getByRole("searchbox");
    await user.clear(input);
    await user.type(input, "knowledge rag");
    await user.click(screen.getByRole("button", { name: "Apply search" }));

    await waitFor(() => {
      expect(screen.getByText("Knowledge / RAG agent")).toBeTruthy();
    });
  });
});
