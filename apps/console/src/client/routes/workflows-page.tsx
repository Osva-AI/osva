import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useWorkflowsListQuery } from "../hooks/use-workflows";
import { formatTimestamp } from "../lib/formatting";

export function WorkflowsPage() {
  const workflowsQuery = useWorkflowsListQuery();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">
            Workflow registry definitions in the authenticated workspace.
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void workflowsQuery.refetch()}
          disabled={workflowsQuery.isFetching}
        >
          Refresh
        </button>
      </header>

      {workflowsQuery.isLoading ? (
        <LoadingBlock label="Loading workflows…" />
      ) : null}
      {workflowsQuery.isError ? (
        <ErrorState
          title="Failed to load workflows"
          error={workflowsQuery.error}
        />
      ) : null}

      {workflowsQuery.data !== undefined &&
      workflowsQuery.data.workflows.length === 0 ? (
        <EmptyState
          title="No workflows yet."
          description="Workflows registered in this workspace will appear here."
        />
      ) : null}

      {workflowsQuery.data !== undefined &&
      workflowsQuery.data.workflows.length > 0 ? (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Workflow ID</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {workflowsQuery.data.workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>{workflow.name}</td>
                  <td className="mono">{workflow.key}</td>
                  <td>
                    <Link className="mono" to={`/workflows/${workflow.id}`}>
                      {workflow.id}
                    </Link>
                  </td>
                  <td>{formatTimestamp(workflow.createdAt)}</td>
                  <td>{formatTimestamp(workflow.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
