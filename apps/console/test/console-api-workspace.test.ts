import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consoleFetch,
  workspaceIdForRequest,
} from "../src/client/lib/console-api.js";
import * as workspaceSelection from "../src/client/lib/workspace-selection.js";

describe("console workspace request pinning", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pins workspace header when explicit workspaceId is provided", () => {
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "workspace-b",
    );
    expect(workspaceIdForRequest("workspace-a")).toBe("workspace-a");
  });

  it("sends pinned workspace header on fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(workspaceSelection, "getSelectedWorkspaceId").mockReturnValue(
      "workspace-b",
    );

    await consoleFetch("/api/v1/agents", undefined, {
      workspaceId: "workspace-a",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-osva-workspace-id")).toBe("workspace-a");
  });
});
