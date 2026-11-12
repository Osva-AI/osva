import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceMutationFetch } from "../src/client/lib/console-api.js";
import * as workspaceSelection from "../src/client/lib/workspace-selection.js";

describe("office mission/task mutation workspace pinning", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pins workspace when launching an assignment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "asn-1", status: "RUNNING" }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "ws-b",
    );

    await workspaceMutationFetch(
      "/api/v1/office/assignments/asn-1/launch",
      { method: "POST", body: "{}" },
      { workspaceId: "ws-a" },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-osva-workspace-id")).toBe("ws-a");
  });
});
