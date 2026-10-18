import { vi } from "vitest";

import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function stubHumanSessionFetch(
  role: string,
  workspaceId = "ws-1",
  extra?: (url: string, init?: RequestInit) => Response | undefined,
): ReturnType<typeof vi.fn> {
  setSelectedWorkspaceId(workspaceId);
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const extraResponse = extra?.(url, init);
    if (extraResponse !== undefined) {
      return extraResponse;
    }
    if (url.includes("/api/v1/auth/session")) {
      return json({
        userId: "user-1",
        sessionId: "session-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    if (url.includes("/api/v1/auth/me")) {
      return json({
        userId: "user-1",
        email: "operator@example.com",
        displayName: "Operator",
        status: "ACTIVE",
      });
    }
    if (url.includes("/api/v1/auth/workspaces")) {
      return json({
        workspaces: [
          {
            workspaceId,
            name: "Test workspace",
            role,
          },
        ],
      });
    }
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
