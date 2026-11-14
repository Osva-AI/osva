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
import { ConnectorCatalogDetailPage } from "../src/client/routes/connector-catalog-detail-page";
import { ConnectorCatalogSetupPage } from "../src/client/routes/connector-catalog-setup-page";
import { ConnectorDetailPage } from "../src/client/routes/connector-detail-page";
import { AgentsPage } from "../src/client/routes/agents-page";
import { RunStepTimeline } from "../src/client/components/run/run-step-timeline";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderJourney(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/tools/connectors/catalog/:catalogConnectorId"
              element={<ConnectorCatalogDetailPage />}
            />
            <Route
              path="/tools/connectors/catalog/:catalogConnectorId/setup"
              element={<ConnectorCatalogSetupPage />}
            />
            <Route
              path="/tools/connectors/:connectorId"
              element={<ConnectorDetailPage />}
            />
            <Route path="/agents" element={<AgentsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("B6.3D journey acceptance (mocked Console BFF)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("scenario A: published catalog entry opens guided setup", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderJourney("/tools/connectors/catalog/github");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-detail-page")).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId("connector-catalog-guided-setup"));
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-setup-page")).toBeTruthy();
    });
  });

  it("scenario A: discover handoff → import → agent handoff", async () => {
    const fetchMock = stubHumanSessionFetch(
      "DEVELOPER",
      "ws-1",
      (url, init) => {
        if (url.endsWith("/api/v1/connectors") && init?.method === "POST") {
          return Response.json({
            id: "conn-github",
            workspaceId: "ws-1",
            key: "osva-connector-github",
            name: "GitHub",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
        if (url.match(/\/api\/v1\/connectors\/conn-github$/)) {
          return Response.json({
            id: "conn-github",
            workspaceId: "ws-1",
            key: "osva-connector-github",
            name: "GitHub",
            description: "Workspace GitHub connector",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
        if (url.endsWith("/api/v1/connectors")) {
          return Response.json({
            connectors: [
              {
                id: "conn-github",
                workspaceId: "ws-1",
                key: "osva-connector-github",
                name: "GitHub",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (
          url.includes("/discover") &&
          (init?.method === "POST" || init?.method === "post")
        ) {
          return Response.json({
            connectorVersionId: "cv-1",
            tools: [
              {
                remoteToolName: "get_repo",
                description: "Read repository metadata",
                inputSchema: { type: "object" },
              },
            ],
          });
        }
        if (
          url.includes("/api/v1/connectors/conn-github/versions") &&
          (init?.method === undefined || init.method === "GET")
        ) {
          return Response.json({
            versions: [
              {
                id: "cv-1",
                connectorId: "conn-github",
                version: 1,
                kind: "MCP",
                transport: "STDIO",
                transportConfig: { command: "node", args: ["dist/main.js"] },
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (
          url.endsWith("/api/v1/connectors/import-mcp-tools") &&
          init?.method === "POST"
        ) {
          return Response.json({
            imported: [
              {
                toolId: "tool-1",
                toolVersionId: "tv-imported-1",
                toolKey: "get_repo",
                remoteToolName: "get_repo",
                createdNewToolVersion: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/v1/tools")) {
          return Response.json({ tools: [] });
        }
        if (url.endsWith("/api/v1/agents")) {
          return Response.json({ agents: [] });
        }
        return undefined;
      },
    );

    renderJourney("/tools/connectors/conn-github#discover-import");
    await waitFor(() => {
      expect(
        screen.getByTestId("integrations-connector-detail-page"),
      ).toBeTruthy();
    });

    await userEvent.selectOptions(
      screen.getByLabelText(/Connector version/i),
      "cv-1",
    );
    const detailPage = screen.getByTestId("integrations-connector-detail-page");
    await userEvent.click(
      within(detailPage).getByRole("button", { name: /^Discover tools$/i }),
    );
    await waitFor(() => {
      expect(within(detailPage).getByText(/Found 1 remote tool/i)).toBeTruthy();
    });

    const checkbox = screen.getAllByRole("checkbox")[0];
    await userEvent.click(checkbox);
    await userEvent.click(
      screen.getByRole("button", { name: /Review import/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Confirm import/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("connector-import-handoff-panel")).toBeTruthy();
    });
    const useInAgent = screen.getByTestId(
      "connector-use-tools-in-agent",
    ) as HTMLAnchorElement;
    expect(useInAgent.getAttribute("href")).toBe(
      "/agents?toolVersionIds=tv-imported-1",
    );

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).includes("/discover") && init?.method === "POST",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/v1/connectors/import-mcp-tools") &&
          init?.method === "POST",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/v1/runs") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("scenario B: tools-imported setup shows agent binding without recreating connector", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({
          connectors: [
            {
              id: "conn-github",
              workspaceId: "ws-1",
              key: "osva-connector-github",
              name: "GitHub",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/connectors/conn-github/versions")) {
        return Response.json({
          versions: [
            {
              id: "cv-1",
              connectorId: "conn-github",
              version: 1,
              kind: "MCP",
              transport: "STDIO",
              transportConfig: { command: "node", args: ["dist/main.js"] },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/tools/tool-gh/versions")) {
        return Response.json({
          versions: [
            {
              id: "tv-existing",
              toolId: "tool-gh",
              version: 1,
              type: "MCP",
              implementation: "MCP_V1",
              mcp: {
                connectorVersionId: "cv-1",
                remoteToolName: "get_repo",
                inputSchema: {},
              },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({
          tools: [
            {
              id: "tool-gh",
              workspaceId: "ws-1",
              key: "get_repo",
              name: "Get repo",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    renderJourney("/tools/connectors/catalog/github/setup?step=discover");
    await waitFor(() => {
      expect(screen.getByTestId("connector-setup-tools-imported")).toBeTruthy();
    });
    const agentLink = screen.getByTestId(
      "connector-setup-use-in-agent",
    ) as HTMLAnchorElement;
    expect(agentLink.getAttribute("href")).toContain(
      "toolVersionIds=tv-existing",
    );
    expect(screen.queryByTestId("connector-setup-create-identity")).toBeNull();
  });

  it("scenario C: missing prerequisites show evidence copy on requirements step", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderJourney("/tools/connectors/catalog/github/setup?step=requirements");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-setup-page")).toBeTruthy();
    });
    expect(screen.getByText(/Node.js 20\+ required/i)).toBeTruthy();
    expect(
      screen.getByTestId("connector-setup-journey-status").textContent,
    ).toMatch(/No linked workspace connector/i);
  });

  it("renders Tool RunStep diagnostics without raw provider payloads", () => {
    render(
      <RunStepTimeline
        steps={[
          {
            id: "rs-tool-1",
            kind: "TOOL",
            bindingName: "get_repo",
            status: "FAILED",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:01.000Z",
            toolVersionId: "tv-1",
            errorCode: "TOOL_NOT_AUTHORIZED",
          },
        ]}
        isLoading={false}
        isLive={false}
      />,
    );
    expect(screen.getByTestId("run-step-timeline")).toBeTruthy();
    expect(screen.getByText(/Tool authorization denied/i)).toBeTruthy();
    expect(screen.getAllByText("tv-1").length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toMatch(/BEGIN PRIVATE KEY/);
  });
});
