import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider } from "../src/client/context/auth-context";
import { ConnectorDetailPage } from "../src/client/routes/connector-detail-page";
import { INVALID_MCP_DISCOVERY_TOOLS_MESSAGE } from "../src/client/lib/connector-discovery-response";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderConnectorDetail(
  stub: Parameters<typeof stubHumanSessionFetch>[2],
) {
  stubHumanSessionFetch("DEVELOPER", "ws-1", stub);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/tools/connectors/conn-1"]}>
          <Routes>
            <Route
              path="/tools/connectors/:connectorId"
              element={<ConnectorDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function connectorApiStubs(
  discoverBody: unknown,
): NonNullable<Parameters<typeof stubHumanSessionFetch>[2]> {
  return (url, init) => {
    if (url.match(/\/api\/v1\/connectors\/conn-1$/)) {
      return Response.json({
        id: "conn-1",
        workspaceId: "ws-1",
        key: "test-connector",
        name: "Test connector",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    if (
      url.includes("/conn-1/versions") &&
      (init?.method === undefined || init.method === "GET")
    ) {
      return Response.json({
        versions: [
          {
            id: "cv-1",
            connectorId: "conn-1",
            version: 1,
            kind: "MCP",
            transport: "STREAMABLE_HTTP",
            transportConfig: { endpointUrl: "https://mcp.example/mcp" },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    if (url.includes("/discover") && init?.method === "POST") {
      return Response.json(discoverBody, { status: 200 });
    }
    if (url.endsWith("/api/v1/tools")) {
      return Response.json({ tools: [] });
    }
    return undefined;
  };
}

describe("connector detail MCP discovery", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function runDiscover(): Promise<void> {
    await waitFor(() => {
      expect(
        screen.getByTestId("integrations-connector-detail-page"),
      ).toBeTruthy();
    });
    const detailPage = screen.getByTestId("integrations-connector-detail-page");
    await userEvent.selectOptions(
      within(detailPage).getByLabelText(/Connector version/i),
      "cv-1",
    );
    await userEvent.click(
      within(detailPage).getByRole("button", { name: /^Discover tools$/i }),
    );
  }

  it("shows discovery error UI for null tools without zero-tool success copy", async () => {
    renderConnectorDetail(
      connectorApiStubs({
        connectorVersionId: "cv-1",
        tools: null,
      }),
    );
    await runDiscover();
    await waitFor(() => {
      expect(screen.getByText(/MCP discovery failed/i)).toBeTruthy();
    });
    expect(screen.getByText(INVALID_MCP_DISCOVERY_TOOLS_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/Found 0 remote tool/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Review import/i })).toBeNull();
  });

  it("shows legitimate zero-tool discovery after a failed response on retry", async () => {
    let discoverCalls = 0;
    renderConnectorDetail((url, init) => {
      if (url.includes("/discover") && init?.method === "POST") {
        discoverCalls += 1;
        if (discoverCalls === 1) {
          return Response.json({ connectorVersionId: "cv-1", tools: "bad" });
        }
        return Response.json({
          connectorVersionId: "cv-1",
          tools: [],
        });
      }
      return connectorApiStubs({ connectorVersionId: "cv-1", tools: [] })(
        url,
        init,
      );
    });
    await runDiscover();
    await waitFor(() => {
      expect(
        screen.getByText(INVALID_MCP_DISCOVERY_TOOLS_MESSAGE),
      ).toBeTruthy();
    });
    await runDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Found 0 remote tool/i)).toBeTruthy();
    });
  });
});
