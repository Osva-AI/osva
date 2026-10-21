import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { WorkflowBuilderWorkspace } from "../components/workflow/workflow-builder-workspace";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useWorkflowQuery,
  useWorkflowVersionQuery,
  useWorkflowVersionsQuery,
} from "../hooks/use-workflows";
import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";

import { createDraftForNewWorkflowVersion } from "../lib/workflow-builder-clone";
import type { WorkflowBuilderDraft } from "../lib/workflow-builder-draft";
import { ConsoleApiError } from "../lib/console-api";

export function WorkflowVersionCreatePage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const workflowQuery = useWorkflowQuery(workflowId);
  const versionsQuery = useWorkflowVersionsQuery(workflowId);

  const sourceVersionIdParam = searchParams.get("from") ?? undefined;
  const sortedVersions = useMemo(() => {
    const versions = versionsQuery.data?.versions ?? [];
    return [...versions].sort((left, right) => right.version - left.version);
  }, [versionsQuery.data?.versions]);

  const defaultSourceVersionId = sourceVersionIdParam ?? sortedVersions[0]?.id;
  const sourceVersionQuery = useWorkflowVersionQuery(
    workflowId,
    defaultSourceVersionId,
  );

  const [draft, setDraft] = useState<WorkflowBuilderDraft | undefined>();
  const [initializedFromVersionId, setInitializedFromVersionId] = useState<
    string | undefined
  >();

  useEffect(() => {
    if (
      authQuery.data === undefined ||
      workflowQuery.data === undefined ||
      sourceVersionQuery.data === undefined ||
      workflowId === undefined
    ) {
      return;
    }
    const sourceId = sourceVersionQuery.data.id;
    if (initializedFromVersionId === sourceId) {
      return;
    }
    setDraft(
      createDraftForNewWorkflowVersion({
        workspaceId: authQuery.data.workspaceId,
        createdWorkflowId: workflowId,
        sourceVersionId: sourceId,
        registry: {
          key: workflowQuery.data.key,
          name: workflowQuery.data.name,
          ...(workflowQuery.data.description !== undefined
            ? { description: workflowQuery.data.description }
            : {}),
        },
        definition: sourceVersionQuery.data.definition as WorkflowDefinitionV3,
      }),
    );
    setInitializedFromVersionId(sourceId);
  }, [
    authQuery.data,
    initializedFromVersionId,
    sourceVersionQuery.data,
    workflowId,
    workflowQuery.data,
  ]);

  if (workflowId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workflowId.")}
      />
    );
  }

  const notFound =
    workflowQuery.isError &&
    workflowQuery.error instanceof ConsoleApiError &&
    workflowQuery.error.status === 404;

  if (workflowQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingBlock label="Loading workflow…" />;
  }

  if (notFound) {
    return (
      <EmptyState
        title="Workflow not found."
        description="This workflow is not visible in your workspace."
      />
    );
  }

  if (sortedVersions.length === 0) {
    return (
      <EmptyState
        title="No published versions yet."
        description="Publish an initial version from Create workflow (/workflows/new)."
      />
    );
  }

  if (
    draft === undefined ||
    sourceVersionQuery.isLoading ||
    sourceVersionQuery.data === undefined
  ) {
    return <LoadingBlock label="Loading source version…" />;
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Source version</h2>
        <p className="muted">
          You are creating a new immutable version. The selected source is
          copied into an editable draft; published versions are never modified
          in place.
        </p>
        <div className="field">
          <label htmlFor="workflow-source-version">Copy from version</label>
          <select
            id="workflow-source-version"
            value={defaultSourceVersionId ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              if (next.length === 0) {
                return;
              }
              navigate(
                `/workflows/${workflowId}/versions/new?from=${encodeURIComponent(next)}`,
                { replace: true },
              );
              setInitializedFromVersionId(undefined);
            }}
          >
            {sortedVersions.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.version} ({version.id})
              </option>
            ))}
          </select>
        </div>
      </section>

      <WorkflowBuilderWorkspace
        mode="newVersion"
        title="Publish new workflow version"
        subtitle={`New version for ${workflowQuery.data?.name ?? "workflow"}. Adjust steps, validate, then publish.`}
        initialDraft={draft}
        backLink={{
          to: `/workflows/${workflowId}`,
          label: "Back to workflow",
        }}
        onPublished={({ workflowId: wfId, versionId }) => {
          navigate(`/workflows/${wfId}/versions/${versionId}`, {
            replace: true,
          });
        }}
      />
    </>
  );
}
