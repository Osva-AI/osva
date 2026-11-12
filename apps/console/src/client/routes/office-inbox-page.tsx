import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  useOfficeInboxQuery,
  type InboxItemResource,
} from "../hooks/use-office-collaboration";
import { formatTimestamp } from "../lib/formatting";

type InboxFilter = "all" | "unread" | "mentions";

function filterInboxItems(
  items: readonly InboxItemResource[],
  filter: InboxFilter,
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

export function OfficeInboxPage() {
  const inboxQuery = useOfficeInboxQuery();
  const [filter, setFilter] = useState<InboxFilter>("all");

  const visibleItems = useMemo(() => {
    const items = inboxQuery.data?.items ?? [];
    return filterInboxItems(items, filter);
  }, [filter, inboxQuery.data?.items]);

  return (
    <>
      <PageHeader
        title="Unified Inbox"
        subtitle="Chat messages and @mentions for this workspace. Approvals and assignments are not included in M22.2A."
      />
      <OfficeSectionNav active="inbox" />
      <SectionPanel title="Inbox">
        <p className="panel-help">
          Only <code>CHAT_MESSAGE</code> and <code>CHAT_MENTION</code> items
          appear here. Mentioning a worker does not start a Run. Filters apply
          to the loaded inbox page only, not the full server backlog.
        </p>
        <div
          className="office-inbox-filters"
          role="tablist"
          aria-label="Inbox filters"
        >
          {(["all", "unread", "mentions"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? "primary" : "secondary"}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "All"
                : value === "unread"
                  ? "Unread"
                  : "Mentions"}
            </Button>
          ))}
        </div>
        {inboxQuery.isLoading ? <LoadingBlock label="Loading inbox…" /> : null}
        {inboxQuery.isError ? (
          <>
            <ErrorState title="Failed to load inbox" error={inboxQuery.error} />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void inboxQuery.refetch()}
            >
              Retry
            </Button>
          </>
        ) : null}
        {inboxQuery.data !== undefined && visibleItems.length === 0 ? (
          <EmptyState
            title="Inbox clear"
            description="No items match this filter."
          />
        ) : null}
        <ul className="office-inbox-list" role="list">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className={
                item.unread
                  ? "office-inbox-item office-inbox-item--unread"
                  : "office-inbox-item"
              }
            >
              <div className="office-inbox-item-header">
                <span className="office-inbox-kind">{item.kind}</span>
                <time dateTime={item.occurredAt}>
                  {formatTimestamp(item.occurredAt)}
                </time>
              </div>
              <strong>{item.title}</strong>
              {item.summary !== undefined ? <p>{item.summary}</p> : null}
              {item.threadId !== undefined ? (
                <Link
                  to={`/office/chat/${item.threadId}`}
                  className="text-link"
                >
                  Open conversation
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionPanel>
    </>
  );
}
