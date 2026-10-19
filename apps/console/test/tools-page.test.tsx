import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorsPage } from "../src/client/routes/connectors-page";
import { ToolsPage } from "../src/client/routes/tools-page";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderTools(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/connectors" element={<ConnectorsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Tools UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders tools list with catalog summaries", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({
          tools: [
            {
              id: "tool-1",
              workspaceId: "ws-1",
              key: "echo",
              name: "Echo Tool",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/tools/tool-1/versions")) {
        return Response.json({
          versions: [
            {
              id: "tv-1",
              toolId: "tool-1",
              version: 1,
              type: "MCP",
              implementation: "MCP_V1",
              mcp: {
                connectorVersionId: "cv-1",
                remoteToolName: "echo",
                inputSchema: { type: "object" },
              },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    renderTools("/tools");
    await waitFor(() => {
      expect(screen.getByText("Echo Tool")).toBeTruthy();
    });
    expect(screen.getByText("MCP")).toBeTruthy();
  });

  it("hides connector create form for VIEWER", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      return undefined;
    });
    renderTools("/tools/connectors");
    await waitFor(() => {
      expect(screen.getByText("Connectors")).toBeTruthy();
    });
    expect(screen.queryByText("Create connector")).toBeNull();
  });
});
