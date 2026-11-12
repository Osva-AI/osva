import { describe, expect, it } from "vitest";

import { createQueryClient } from "../src/client/lib/query-client";
import { flattenOfficeThreadMessages } from "../src/client/lib/office-chat-messages";
import type { OfficeMessageResource } from "../src/client/hooks/use-office-collaboration";

describe("office collaboration workspace isolation", () => {
  it("clears cached office data when workspace selection changes", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["office", "ws-a", "threads"], {
      items: [{ id: "t1", title: "Workspace A thread", workspaceId: "ws-a" }],
    });
    queryClient.setQueryData(["office", "ws-a", "inbox"], {
      items: [{ id: "in-1", kind: "CHAT_MESSAGE", unread: true }],
    });

    void queryClient.cancelQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    });

    expect(
      queryClient.getQueryData(["office", "ws-a", "threads"]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(["office", "ws-b", "threads"]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(["office", "ws-a", "inbox"]),
    ).toBeUndefined();
  });

  it("deduplicates paged messages by id while preserving sequence order", () => {
    const duplicate: OfficeMessageResource = {
      id: "m1",
      workspaceId: "ws-1",
      threadId: "t1",
      sequence: 1,
      authorType: "HUMAN",
      authorUserId: "u1",
      body: "Hello",
      mentions: [],
      references: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const merged = flattenOfficeThreadMessages([
      { items: [duplicate] },
      {
        items: [duplicate, { ...duplicate, id: "m2", sequence: 2, body: "Hi" }],
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.sequence)).toEqual([1, 2]);
  });
});
