import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { handleConsoleAuthError } from "../src/client/context/auth-context.js";
import {
  ConsoleApiError,
  workspaceIdForRequest,
  workspaceMutationFetch,
  workspaceScopedFetch,
} from "../src/client/lib/console-api.js";
import {
  clearSelectedWorkspaceId,
  getSelectedWorkspaceId,
  reconcileSelectedWorkspace,
  setSelectedWorkspaceId,
} from "../src/client/lib/workspace-selection.js";
import * as workspaceSelection from "../src/client/lib/workspace-selection.js";

describe("workspace selection storage", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("reconciles unknown workspace after membership revocation", () => {
    setSelectedWorkspaceId("ws-a");
    expect(reconcileSelectedWorkspace(["ws-b"])).toBeUndefined();
    expect(getSelectedWorkspaceId()).toBeUndefined();
  });

  it("preserves independent workspace ids per tab (sessionStorage semantics)", () => {
    setSelectedWorkspaceId("ws-a");
    expect(getSelectedWorkspaceId()).toBe("ws-a");
    sessionStorage.setItem("osva.console.selectedWorkspaceId", "ws-b");
    expect(getSelectedWorkspaceId()).toBe("ws-b");
  });
});

describe("workspace scoped API clients", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pins query header to explicit workspace id, not live selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "ws-b",
    );

    await workspaceScopedFetch("ws-a", "/api/v1/agents");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-osva-workspace-id")).toBe("ws-a");
  });

  it("captures mutation workspace at execution time", async () => {
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId")
      .mockReturnValueOnce("ws-a")
      .mockReturnValueOnce("ws-b");
    expect(workspaceIdForRequest()).toBe("ws-a");
    expect(workspaceIdForRequest()).toBe("ws-b");
  });

  it("ignores live workspace selection when query key workspace differs (delayed switch)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "run-a" }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "ws-b",
    );

    const delayed = workspaceScopedFetch<{ id: string }>(
      "ws-a",
      "/api/v1/runs/r1",
    );
    setSelectedWorkspaceId("ws-b");
    await delayed;

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-osva-workspace-id")).toBe("ws-a");
  });

  it("uses pinned mutation workspace on fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "ws-b",
    );

    await workspaceMutationFetch(
      "/api/v1/runs",
      { method: "POST", body: "{}" },
      {
        workspaceId: "ws-a",
      },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-osva-workspace-id")).toBe("ws-a");
  });
});

describe("handleConsoleAuthError", () => {
  afterEach(() => {
    clearSelectedWorkspaceId();
  });

  it("clears workspace selection when membership is required", () => {
    setSelectedWorkspaceId("ws-a");
    const auth = {
      clearAuthState: vi.fn(),
    } as unknown as Parameters<typeof handleConsoleAuthError>[1];

    const outcome = handleConsoleAuthError(
      new ConsoleApiError(403, {
        error: "denied",
        code: "workspace_membership_required",
      }),
      auth,
    );
    expect(outcome).toBe("select-workspace");
    expect(getSelectedWorkspaceId()).toBeUndefined();
    expect(auth.clearAuthState).not.toHaveBeenCalled();
  });

  it("clears workspace selection when workspace access is denied", () => {
    setSelectedWorkspaceId("ws-a");
    const auth = {
      clearAuthState: vi.fn(),
    } as unknown as Parameters<typeof handleConsoleAuthError>[1];

    const outcome = handleConsoleAuthError(
      new ConsoleApiError(403, {
        error: "denied",
        code: "workspace_access_denied",
      }),
      auth,
    );
    expect(outcome).toBe("select-workspace");
    expect(getSelectedWorkspaceId()).toBeUndefined();
  });
});

describe("workspace switch cache eviction", () => {
  it("removes non-auth cache entries on workspace change", async () => {
    const client = new QueryClient();
    client.setQueryData(["agents", "ws-a", "list"], { agents: [{ id: "1" }] });
    client.setQueryData(["auth", "workspaces"], [{ workspaceId: "ws-a" }]);

    await client.removeQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    });

    expect(client.getQueryData(["agents", "ws-a", "list"])).toBeUndefined();
    expect(client.getQueryData(["auth", "workspaces"])).toBeDefined();
  });
});
