import { describe, expect, it } from "vitest";

import type { InboxItemResource } from "../src/client/hooks/use-office-collaboration";
import { filterInboxItems } from "../src/client/routes/office-inbox-page";

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
  {
    id: "3",
    kind: "APPROVAL_PENDING",
    occurredAt: "2026-01-03T00:00:00.000Z",
    unread: true,
    title: "Approve",
    approvalRequestId: "appr-1",
    workflowRunId: "wfr-1",
  },
];

describe("inbox filters", () => {
  it("filters unread, mention, and operational items", () => {
    expect(filterInboxItems(SAMPLE, "all")).toHaveLength(3);
    expect(filterInboxItems(SAMPLE, "unread")).toHaveLength(2);
    expect(filterInboxItems(SAMPLE, "mentions")).toHaveLength(1);
    expect(filterInboxItems(SAMPLE, "approvals")).toHaveLength(1);
    expect(filterInboxItems(SAMPLE, "assignments")).toHaveLength(0);
  });
});
