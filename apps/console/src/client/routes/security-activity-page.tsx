import { useQuery } from "@tanstack/react-query";

import { useWorkspaceAccess } from "../context/auth-context";
import { consoleFetch } from "../lib/console-api";
import { roleCanReadAuditEvents } from "../lib/permissions";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";

interface AuditEventRow {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly details: Record<string, unknown>;
}

export function SecurityActivityPage() {
  const access = useWorkspaceAccess();

  const eventsQuery = useQuery({
    queryKey: ["auth", "audit-events", access?.workspaceId],
    enabled: access !== undefined && roleCanReadAuditEvents(access.role),
    queryFn: async () => {
      const body = await consoleFetch<{ events: AuditEventRow[] }>(
        "/api/v1/auth/audit-events",
      );
      return body.events;
    },
  });

  if (access === undefined) {
    return <LoadingBlock label="Loading workspace…" />;
  }

  if (!roleCanReadAuditEvents(access.role)) {
    return (
      <ErrorState
        title="Permission denied"
        error={new Error("Audit read permission is required.")}
      />
    );
  }

  if (eventsQuery.isLoading) {
    return <LoadingBlock label="Loading security activity…" />;
  }

  if (eventsQuery.isError) {
    return (
      <ErrorState
        title="Could not load audit events"
        error={eventsQuery.error}
      />
    );
  }

  return (
    <section>
      <h1>Security activity</h1>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Event</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {eventsQuery.data?.map((event) => (
            <tr key={event.id}>
              <td>{event.occurredAt}</td>
              <td>{event.eventType}</td>
              <td>
                <pre>{JSON.stringify(event.details, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
