import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConnectorCatalogPage } from "../src/client/routes/connector-catalog-page";
import { ConnectorCatalogDetailPage } from "../src/client/routes/connector-catalog-detail-page";
import { ConnectorCatalogSetupPage } from "../src/client/routes/connector-catalog-setup-page";
import { AuthProvider } from "../src/client/context/auth-context";
import { filterConnectorCatalogEntries } from "../src/client/lib/osva-connectors-catalog";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderCatalog(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/tools/connectors/catalog"
              element={<ConnectorCatalogPage />}
            />
            <Route
              path="/tools/connectors/catalog/:catalogConnectorId"
              element={<ConnectorCatalogDetailPage />}
            />
            <Route
              path="/tools/connectors/catalog/:catalogConnectorId/setup"
              element={<ConnectorCatalogSetupPage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("connector catalog pages", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders browse page with catalog cards", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderCatalog("/tools/connectors/catalog");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-page")).toBeTruthy();
    });
    expect(screen.getByTestId("connector-catalog-card-github")).toBeTruthy();
  });

  it("renders github detail with mutation guidance", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderCatalog("/tools/connectors/catalog/github");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-detail-page")).toBeTruthy();
    });
    expect(screen.getByText(/operator must enable/i)).toBeTruthy();
    expect(screen.getByTestId("connector-tool-risk-badge")).toBeTruthy();
  });

  it("search filter is pure and does not mutate catalog", () => {
    const before = filterConnectorCatalogEntries({
      query: "",
      capability: "all",
      transport: "all",
    }).length;
    const filtered = filterConnectorCatalogEntries({
      query: "zoho",
      capability: "all",
      transport: "all",
    });
    const after = filterConnectorCatalogEntries({
      query: "",
      capability: "all",
      transport: "all",
    }).length;
    expect(before).toBe(45);
    expect(after).toBe(45);
    expect(filtered.length).toBeGreaterThan(0);
  });
});
