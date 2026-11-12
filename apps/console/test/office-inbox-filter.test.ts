import { describe, expect, it } from "vitest";

import type { InboxItemResource } from "../src/client/hooks/use-office-collaboration";

function filterInboxItems(
  items: readonly InboxItemResource[],
  filter: "all" | "unread" | "mentions",
): readonly InboxItemResource[] {
  switch (filter) {
    case "unread":
      return items.filter((item) => item.unread);
    case "mentions":
      return items.filter((item) => item.kind === "CHAT_MENTION");
    default:
      return items;
  }
}

const SAMPLE: readonly InboxItemResource[] = [
  {
    id: "1",
    kind: "CHAT_MESSAGE",
    occurredAt: "2026-01-01T00:00:00.000Z",
    unread: false,
    title: "A",
  },
  {
    id: "2",
    kind: "CHAT_MENTION",
    occurredAt: "2026-01-02T00:00:00.000Z",
    unread: true,
    title: "B",
  },
];

describe("inbox filters", () => {
  it("filters unread and mention items", () => {
    expect(filterInboxItems(SAMPLE, "all")).toHaveLength(2);
    expect(filterInboxItems(SAMPLE, "unread")).toHaveLength(1);
    expect(filterInboxItems(SAMPLE, "mentions")).toHaveLength(1);
  });
});
