import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { MemoryNamespacePage } from "../src/client/routes/memory-namespace-page";
import { MemoryPage } from "../src/client/routes/memory-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

const FIXTURE_RECORD_VALUE = { fixture: "sanitized-preview-only" };

function renderMemory(initialPath = "/memory") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/memory" element={<MemoryPage />} />
            <Route
              path="/memory/namespaces/:namespaceId"
              element={<MemoryNamespacePage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Memory UI V2.7D", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders hub empty state", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/memory/namespaces")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderMemory();
    await waitFor(() => {
      expect(screen.getByText(/No memory namespaces yet/i)).toBeTruthy();
    });
  });

  it("hides create form for VIEWER", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/memory/namespaces")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderMemory();
    await waitFor(() => {
      expect(screen.getByText(/Read-only access/i)).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: "Create namespace" }),
    ).toBeNull();
  });

  it("applies prefix filter and paginates records", async () => {
    const user = userEvent.setup();
    let recordsCall = 0;
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/memory/namespaces/ns-1/records")) {
        recordsCall += 1;
        if (url.includes("prefix=user.")) {
          return json({
            items: [
              {
                key: "user.settings",
                revision: 2,
                value: FIXTURE_RECORD_VALUE,
              },
            ],
          });
        }
        if (url.includes("cursor=page-2")) {
          return json({
            items: [
              { key: "session.b", revision: 1, value: FIXTURE_RECORD_VALUE },
            ],
          });
        }
        return json({
          items: [
            { key: "session.a", revision: 1, value: FIXTURE_RECORD_VALUE },
          ],
          nextCursor: "page-2",
        });
      }
      if (url.includes("/api/v1/memory/namespaces/ns-1")) {
        return json({
          id: "ns-1",
          workspaceId: "ws-1",
          key: "session",
          name: "Session store",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/memory/namespaces")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderMemory("/memory/namespaces/ns-1");
    await waitFor(() => {
      expect(screen.getByTestId("memory-namespace-detail-page")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("session.a")).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/Key prefix filter/i), "user.");
    await user.click(screen.getByRole("button", { name: "Apply filter" }));
    await waitFor(() => {
      expect(screen.getByText("user.settings")).toBeTruthy();
    });
    expect(recordsCall).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText("session.b")).toBeTruthy();
    });
  });

  it("shows truncated preview before expanding full value", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/memory/namespaces/ns-1/records")) {
        return json({
          items: [
            {
              key: "large",
              revision: 1,
              value: { blob: "z".repeat(300) },
            },
          ],
        });
      }
      if (url.includes("/api/v1/memory/namespaces/ns-1")) {
        return json({
          id: "ns-1",
          workspaceId: "ws-1",
          key: "data",
          name: "Data",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      return undefined;
    });

    renderMemory("/memory/namespaces/ns-1");
    await waitFor(() => {
      expect(screen.getByText(/Preview truncated/i)).toBeTruthy();
    });
    expect(screen.queryByText("z".repeat(300))).toBeNull();
  });
});
