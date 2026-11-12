import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAgentVersionCatalogQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateOfficeAssignmentMutation,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../hooks/use-office";
import { useWorkflowVersionCatalogQuery } from "../hooks/use-workflows";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { ConsoleApiError } from "../lib/console-api";
import {
  agentVersionsForWorker,
  isAgentVersionCompatibleWithWorker,
  isWorkflowVersionSelectable,
  parseOfficeTaskInputJson,
  workflowVersionsForWorkspace,
} from "../lib/office-task-validation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

type TargetType = "AGENT_VERSION" | "WORKFLOW_VERSION";

export function OfficeTaskCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const submittingRef = useRef(false);
  const workspaceId = useWorkspaceQueryScope();

  const authQuery = useAuthContextQuery();
  const workersQuery = useOfficeWorkersQuery();
  const goalsQuery = useOfficeGoalsQuery();
  const agentCatalogQuery = useAgentVersionCatalogQuery();
  const workflowCatalogQuery = useWorkflowVersionCatalogQuery();

  const createAssignment = useCreateOfficeAssignmentMutation();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goalId, setGoalId] = useState(searchParams.get("missionId") ?? "");
  const [officeWorkerId, setOfficeWorkerId] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("AGENT_VERSION");
  const [targetVersionId, setTargetVersionId] = useState("");
  const [inputJson, setInputJson] = useState("{}");
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const workers = workersQuery.data?.items ?? [];
  const goals = goalsQuery.data?.items ?? [];

  const selectedWorker = workers.find((worker) => worker.id === officeWorkerId);

  const flatAgentVersions = useMemo(() => {
    return (
      agentCatalogQuery.data?.entries.flatMap((entry) => entry.versions) ?? []
    );
  }, [agentCatalogQuery.data]);

  const flatWorkflowVersions = useMemo(() => {
    return (
      workflowCatalogQuery.data?.entries.flatMap((entry) => entry.versions) ??
      []
    );
  }, [workflowCatalogQuery.data]);

  const compatibleAgentVersions = useMemo(() => {
    if (selectedWorker === undefined) {
      return [];
    }
    return agentVersionsForWorker(selectedWorker.agentId, flatAgentVersions);
  }, [flatAgentVersions, selectedWorker]);

  const selectableWorkflowVersions = useMemo(() => {
    if (workspaceId === undefined) {
      return [];
    }
    return workflowVersionsForWorkspace(flatWorkflowVersions, workspaceId);
  }, [flatWorkflowVersions, workspaceId]);

  const parsedInput = parseOfficeTaskInputJson(inputJson);

  useEffect(() => {
    if (targetType === "AGENT_VERSION") {
      if (
        targetVersionId.length > 0 &&
        selectedWorker !== undefined &&
        !isAgentVersionCompatibleWithWorker(
          targetVersionId,
          selectedWorker.agentId,
          flatAgentVersions,
        )
      ) {
        setTargetVersionId("");
      }
      return;
    }

    if (
      targetVersionId.length > 0 &&
      workspaceId !== undefined &&
      !isWorkflowVersionSelectable(
        targetVersionId,
        workspaceId,
        flatWorkflowVersions,
      )
    ) {
      setTargetVersionId("");
    }
  }, [
    flatAgentVersions,
    flatWorkflowVersions,
    officeWorkerId,
    selectedWorker,
    targetType,
    targetVersionId,
    workspaceId,
  ]);

  const loadingCore =
    workersQuery.isLoading ||
    goalsQuery.isLoading ||
    agentCatalogQuery.isLoading ||
    workflowCatalogQuery.isLoading;

  const loadError =
    workersQuery.isError ||
    goalsQuery.isError ||
    agentCatalogQuery.isError ||
    workflowCatalogQuery.isError;

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || submittingRef.current) {
      return;
    }

    setSubmitError(undefined);
    setErrorRequestId(undefined);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setSubmitError("Task title is required.");
      return;
    }
    if (officeWorkerId.length === 0) {
      setSubmitError("Select an Office Worker.");
      return;
    }
    if (targetVersionId.length === 0) {
      setSubmitError("Select a target version.");
      return;
    }
    if (!parsedInput.ok) {
      setSubmitError(parsedInput.message);
      return;
    }

    if (
      targetType === "AGENT_VERSION" &&
      selectedWorker !== undefined &&
      !isAgentVersionCompatibleWithWorker(
        targetVersionId,
        selectedWorker.agentId,
        flatAgentVersions,
      )
    ) {
      setSubmitError(
        "Selected agent version is not compatible with this worker.",
      );
      return;
    }

    submittingRef.current = true;
    try {
      const assignment = await createAssignment.mutateAsync({
        officeWorkerId,
        title: trimmedTitle,
        targetType,
        targetVersionId,
        input: parsedInput.value,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
        ...(goalId.length > 0 ? { goalId } : {}),
      });

      navigate(`/office/tasks/${assignment.id}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Task creation failed.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    } finally {
      submittingRef.current = false;
    }
  }

  if (!canWrite && authQuery.data !== undefined) {
    return (
      <div
        className="office-v2 page-stack activity-v2"
        data-testid="office-task-create-page"
      >
        <PageHeader
          title="Create Task"
          subtitle="Tasks persist assignments in PENDING until explicitly launched."
        />
        <OfficeSectionNav active="tasks" />
        <p className="muted">
          Creating tasks requires a DEVELOPER, ADMIN, or OWNER role. OPERATOR
          and VIEWER roles have read-only access here.
        </p>
        <LinkButton variant="secondary" to="/office/missions">
          View missions
        </LinkButton>
      </div>
    );
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-task-create-page"
    >
      <PageHeader
        title="Create Task"
        subtitle="Creates a PENDING assignment. Execution does not start until launch from the Task Board (M22.3C) or Inbox."
        actions={
          <LinkButton variant="secondary" to="/office/missions">
            Missions
          </LinkButton>
        }
      />

      <OfficeSectionNav active="tasks" />

      {loadingCore ? <LoadingBlock label="Loading workspace data…" /> : null}

      {loadError ? (
        <ErrorState
          title="Failed to load task form"
          error={new Error("One or more office or catalog requests failed.")}
        />
      ) : null}

      {!loadingCore && !loadError ? (
        <SectionPanel title="Task details">
          {submitError !== undefined ? (
            <p className="form-feedback error" role="alert">
              {submitError}
              {errorRequestId !== undefined ? (
                <span className="mono"> Request ID: {errorRequestId}</span>
              ) : null}
            </p>
          ) : null}
          {!parsedInput.ok ? (
            <p className="form-feedback error" role="alert">
              {parsedInput.message}
            </p>
          ) : null}

          <form
            className="panel"
            onSubmit={(event) => void submitCreate(event)}
          >
            <div className="filters">
              <div className="field">
                <label htmlFor="task-title">Title</label>
                <input
                  id="task-title"
                  value={title}
                  disabled={createAssignment.isPending}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="task-mission">Mission (optional)</label>
                <select
                  id="task-mission"
                  value={goalId}
                  disabled={createAssignment.isPending}
                  onChange={(event) => setGoalId(event.target.value)}
                >
                  <option value="">No mission</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="task-description">Description</label>
              <textarea
                id="task-description"
                rows={2}
                value={description}
                disabled={createAssignment.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="filters">
              <div className="field">
                <label htmlFor="task-worker">Office Worker</label>
                <select
                  id="task-worker"
                  value={officeWorkerId}
                  disabled={createAssignment.isPending}
                  onChange={(event) => {
                    setOfficeWorkerId(event.target.value);
                    setTargetVersionId("");
                  }}
                >
                  <option value="">Select worker</option>
                  {workers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="task-target-type">Target type</label>
                <select
                  id="task-target-type"
                  value={targetType}
                  disabled={createAssignment.isPending}
                  onChange={(event) => {
                    setTargetType(event.target.value as TargetType);
                    setTargetVersionId("");
                  }}
                >
                  <option value="AGENT_VERSION">Agent Version</option>
                  <option value="WORKFLOW_VERSION">Workflow Version</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="task-target-version">
                {targetType === "AGENT_VERSION"
                  ? "Agent version"
                  : "Workflow version"}
              </label>
              <select
                id="task-target-version"
                value={targetVersionId}
                disabled={
                  createAssignment.isPending ||
                  (targetType === "AGENT_VERSION" &&
                    officeWorkerId.length === 0)
                }
                onChange={(event) => setTargetVersionId(event.target.value)}
              >
                <option value="">Select version</option>
                {targetType === "AGENT_VERSION"
                  ? compatibleAgentVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {`v${version.version} · ${version.id}`}
                      </option>
                    ))
                  : selectableWorkflowVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {`v${version.version} · ${version.workflowId}`}
                      </option>
                    ))}
              </select>
              {targetType === "AGENT_VERSION" &&
              officeWorkerId.length > 0 &&
              compatibleAgentVersions.length === 0 ? (
                <p className="muted">
                  No agent versions found for this worker&apos;s agent.
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="task-input">Input (JSON)</label>
              <textarea
                id="task-input"
                rows={6}
                className="mono"
                value={inputJson}
                disabled={createAssignment.isPending}
                onChange={(event) => setInputJson(event.target.value)}
              />
            </div>

            <p className="muted">
              Submission creates a PENDING assignment only — no Run or
              WorkflowRun is started.
            </p>

            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                loading={createAssignment.isPending}
                disabled={
                  createAssignment.isPending ||
                  !parsedInput.ok ||
                  title.trim().length === 0 ||
                  officeWorkerId.length === 0 ||
                  targetVersionId.length === 0
                }
              >
                Create Task
              </Button>
            </div>
          </form>
        </SectionPanel>
      ) : null}

      <p className="muted">
        Need execution controls? <Link to="/office/inbox">Open Inbox</Link> to
        launch pending assignments when authorized.
      </p>
    </div>
  );
}
