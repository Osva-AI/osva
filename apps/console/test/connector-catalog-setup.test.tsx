import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConnectorCatalogDetailPage } from "../src/client/routes/connector-catalog-detail-page";
import { ConnectorCatalogSetupPage } from "../src/client/routes/connector-catalog-setup-page";
import { AuthProvider } from "../src/client/context/auth-context";
import { stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderSetup(initialPath: string) {
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
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("connector catalog guided setup", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("navigates from catalog detail to guided setup", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-guided-setup")).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId("connector-catalog-guided-setup"));
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-setup-page")).toBeTruthy();
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Transport configuration/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("connector-setup-no-http-bridge")).toBeTruthy();
    });
  });

  it("creates workspace connector identity on explicit click", async () => {
    const fetchMock = stubHumanSessionFetch(
      "DEVELOPER",
      "ws-1",
      (url, init) => {
        if (url.endsWith("/api/v1/connectors") && init?.method !== "POST") {
          return Response.json({ connectors: [] });
        }
        if (url.endsWith("/api/v1/tools")) {
          return Response.json({ tools: [] });
        }
        if (url.endsWith("/api/v1/connectors") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            key: string;
            name: string;
          };
          expect(body.key).toBe("osva-connector-github");
          return Response.json({
            id: "conn-github",
            workspaceId: "ws-1",
            key: body.key,
            name: body.name,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
        if (url.includes("/api/v1/connectors/conn-github/versions")) {
          return Response.json({ versions: [] });
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
        return undefined;
      },
    );

    renderSetup("/tools/connectors/catalog/github/setup?step=workspace");
    await waitFor(() => {
      expect(
        screen.getByTestId("connector-setup-recommended-key").textContent,
      ).toContain("osva-connector-github");
    });
    await userEvent.click(
      screen.getByTestId("connector-setup-create-identity"),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/v1/connectors") &&
            init?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("blocks identity creation for read-only roles", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github/setup?step=workspace");
    await waitFor(() => {
      expect(screen.getByTestId("connector-catalog-setup-page")).toBeTruthy();
    });
    expect(screen.queryByTestId("connector-setup-create-identity")).toBeNull();
  });

  it("advances steps via keyboard-accessible stepper buttons", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github/setup");
    await waitFor(() => {
      expect(screen.getByTestId("connector-guided-setup-stepper")).toBeTruthy();
    });
    const transportButton = screen.getByRole("button", {
      name: /Transport configuration/i,
    });
    fireEvent.click(transportButton);
    await waitFor(() => {
      expect(
        screen
          .getByTestId("connector-setup-active-step")
          .getAttribute("data-step"),
      ).toBe("transport");
    });
  });

  it("shows verified install command without arbitrary shell fields", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github/setup?step=requirements");
    await waitFor(() => {
      expect(
        screen.getByTestId("connector-setup-copyable-command"),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(/npm install @osva-ai\/connector-github@/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/executable/i)).toBeNull();
    expect(screen.queryByLabelText(/working directory/i)).toBeNull();
  });

  it("hands off to existing discover UI with deep link", async () => {
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
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
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
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github/setup?step=discover");
    await waitFor(() => {
      expect(
        screen.getByTestId("connector-setup-discover-handoff"),
      ).toBeTruthy();
    });
    const link = screen.getByTestId(
      "connector-setup-discover-handoff",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/tools/connectors/conn-github#discover-import",
    );
  });

  it("shows workspace-scoped unlinked status copy", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.endsWith("/api/v1/connectors")) {
        return Response.json({ connectors: [] });
      }
      if (url.endsWith("/api/v1/tools")) {
        return Response.json({ tools: [] });
      }
      return undefined;
    });
    renderSetup("/tools/connectors/catalog/github/setup");
    await waitFor(() => {
      const status = screen.getByTestId("connector-setup-journey-status");
      expect(status.textContent).toMatch(/No linked workspace connector/i);
    });
  });
});
