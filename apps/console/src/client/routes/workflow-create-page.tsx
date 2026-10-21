import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { WorkflowBuilderWorkspace } from "../components/workflow/workflow-builder-workspace";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { createEmptyWorkflowBuilderDraft } from "../lib/workflow-builder-linear";
import type { WorkflowBuilderDraft } from "../lib/workflow-builder-draft";

export function WorkflowCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authQuery = useAuthContextQuery();
  const [draft, setDraft] = useState<WorkflowBuilderDraft | undefined>();

  useEffect(() => {
    if (authQuery.data === undefined) {
      return;
    }
    setDraft(createEmptyWorkflowBuilderDraft(authQuery.data.workspaceId));
  }, [authQuery.data?.workspaceId]);

  if (draft === undefined) {
    return null;
  }

  return (
    <WorkflowBuilderWorkspace
      mode="create"
      title="Create workflow"
      subtitle="Design a business process with agents, approvals, and waits. Published versions are immutable."
      initialDraft={draft}
      handoffSearchParams={searchParams}
      backLink={{ to: "/workflows", label: "All workflows" }}
      onPublished={({ workflowId, versionId }) => {
        navigate(`/workflows/${workflowId}/versions/${versionId}`, {
          replace: true,
        });
      }}
    />
  );
}
