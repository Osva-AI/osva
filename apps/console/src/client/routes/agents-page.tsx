import { Link, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  AgentHandoffVersionLink,
  ToolVersionHandoffBanner,
} from "../components/connectors/tool-version-handoff-banner";
import { useAgentsListQuery } from "../hooks/use-agents";
import { useToolsCatalogQuery } from "../hooks/use-tools-connectors";
import { parseToolVersionHandoffParam } from "../lib/connector-agent-handoff";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { formatTimestamp } from "../lib/formatting";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function AgentsPage() {
  const [searchParams] = useSearchParams();
  const handoffIds = parseToolVersionHandoffParam(
    searchParams.get("toolVersionIds"),
  );
  const agentsQuery = useAgentsListQuery();
  const toolsCatalogQuery = useToolsCatalogQuery();
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Agent registry in the authenticated workspace. Versions are immutable; launch individual Runs from an AgentVersion."
        actions={
          <>
            <LinkButton variant="secondary" to="/onboarding">
              First-agent guide
            </LinkButton>
            {canWrite ? (
              <>
                <LinkButton variant="secondary" to="/agents/new?templates=1">
                  Templates
                </LinkButton>
                <LinkButton variant="primary" to="/agents/new">
                  Create Agent
                </LinkButton>
              </>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void agentsQuery.refetch()}
              disabled={agentsQuery.isFetching}
              loading={agentsQuery.isFetching}
            >
              Refresh
            </Button>
          </>
        }
      />

      <ToolVersionHandoffBanner
        hintedIds={handoffIds}
        catalog={toolsCatalogQuery.data}
        catalogLoading={toolsCatalogQuery.isLoading}
        canWrite={canWrite}
      />

      {!canWrite ? (
        <p className="muted">
          Registering an Agent requires an EDITOR or ADMIN role. VIEWER can
          inspect existing Agents and versions.
        </p>
      ) : null}

      {agentsQuery.isLoading ? <LoadingBlock label="Loading agents…" /> : null}
      {agentsQuery.isError ? (
        <ErrorState title="Failed to load agents" error={agentsQuery.error} />
      ) : null}

      {agentsQuery.data !== undefined &&
      agentsQuery.data.agents.length === 0 ? (
        <EmptyState
          title="No agents yet."
          description="Create a no-code agent in this workspace, or open an existing agent to publish a new version before launching a Run."
          action={
            canWrite ? (
              <LinkButton variant="primary" to="/agents/new">
                Create Agent
              </LinkButton>
            ) : undefined
          }
        />
      ) : null}

      {agentsQuery.data !== undefined && agentsQuery.data.agents.length > 0 ? (
        <SectionPanel title="Agent registry">
          <DataTableRegion caption="Agents in this workspace">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Agent ID</th>
                <th scope="col">Created</th>
                {handoffIds.length > 0 ? (
                  <th scope="col">Tool handoff</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {agentsQuery.data.agents.map((agent) => (
                <tr key={agent.id}>
                  <td>{agent.name}</td>
                  <td className="mono">{agent.key}</td>
                  <td>
                    <Link className="mono" to={`/agents/${agent.id}`}>
                      {agent.id}
                    </Link>
                  </td>
                  <td>{formatTimestamp(agent.createdAt)}</td>
                  {handoffIds.length > 0 ? (
                    <td>
                      <AgentHandoffVersionLink
                        agentId={agent.id}
                        toolVersionIds={handoffIds}
                        canWrite={canWrite}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </DataTableRegion>
        </SectionPanel>
      ) : null}
    </>
  );
}
