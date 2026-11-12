import { useMemo, useState } from "react";

import { OfficeInboxItemRow } from "../components/office/office-inbox-item-row";
import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useOfficeInboxQuery,
  type InboxItemKind,
  type InboxItemResource,
} from "../hooks/use-office-collaboration";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";

type InboxFilter =
  "all" | "unread" | "mentions" | "approvals" | "assignments" | "deliverables";

function filterInboxItems(
  items: readonly InboxItemResource[],
  filter: InboxFilter,
): readonly InboxItemResource[] {
  switch (filter) {
    case "unread":
      return items.filter((item) => item.unread);
    case "mentions":
      return items.filter((item) => item.kind === "CHAT_MENTION");
    case "approvals":
      return items.filter((item) => item.kind === "APPROVAL_PENDING");
    case "assignments":
      return items.filter((item) => item.kind === "ASSIGNMENT_UPDATE");
    case "deliverables":
      return items.filter((item) => item.kind === "DELIVERABLE_READY");
    default:
      return items;
  }
}

const FILTER_OPTIONS: readonly {
  readonly id: InboxFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
  { id: "approvals", label: "Approvals" },
  { id: "assignments", label: "Assignments" },
  { id: "deliverables", label: "Deliverables" },
];

export function OfficeInboxPage() {
  const inboxQuery = useOfficeInboxQuery();
  const workspaceId = useWorkspaceQueryScope();
  const authContextQuery = useAuthContextQuery();
  const authContextAligned = authContextQuery.data?.workspaceId === workspaceId;
  const canExecute =
    authContextAligned &&
    authContextQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authContextQuery.data.role);
  const [filter, setFilter] = useState<InboxFilter>("all");

  const visibleItems = useMemo(() => {
    const items = inboxQuery.data?.items ?? [];
    return filterInboxItems(items, filter);
  }, [filter, inboxQuery.data?.items]);

  return (
    <>
      <PageHeader
        title="Unified Inbox"
        subtitle="Operational activity and chat for this workspace. Listing inbox data does not start Runs."
      />
      <OfficeSectionNav active="inbox" />
      <SectionPanel title="Inbox">
        <p className="panel-help">
          Unread chat, pending approvals, failed or cancelled assignments, and
          deliverables from completed assignment runs appear here. Filters apply
          to the loaded page only.
        </p>
        <div
          className="office-inbox-filters"
          role="tablist"
          aria-label="Inbox filters"
        >
          {FILTER_OPTIONS.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={filter === option.id ? "primary" : "secondary"}
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
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
            <OfficeInboxItemRow
              key={item.id}
              item={item}
              canExecute={canExecute}
            />
          ))}
        </ul>
      </SectionPanel>
    </>
  );
}

export { filterInboxItems, type InboxFilter, type InboxItemKind };
