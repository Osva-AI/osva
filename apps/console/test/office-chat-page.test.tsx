import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficeChatPage } from "../src/client/routes/office-chat-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

describe("OfficeChatPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders thread list from the BFF", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-chat", (url) => {
      if (url === "/api/v1/office/threads?limit=100") {
        return json({
          items: [
            {
              id: "thread-1",
              workspaceId: "ws-chat",
              title: "Launch",
              type: "WORKSPACE",
              createdByUserId: "user-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              latestMessageSequence: 0,
              unreadCount: 1,
            },
          ],
        });
      }
      if (url.startsWith("/api/v1/auth/")) {
        return json({ memberships: [] });
      }
      if (url === "/api/v1/office/workers") {
        return json({ items: [] });
      }
      return json({});
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/office/chat"]}>
          <OfficeChatPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Launch")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
