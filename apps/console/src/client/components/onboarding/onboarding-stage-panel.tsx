import { useState } from "react";
import { Link } from "react-router-dom";

import {
  buildWorkspaceSetupGuidance,
  setupGuidanceLabel,
  type SetupGuidanceState,
} from "../../lib/workspace-setup-guidance";
import {
  guidedStepVisualLabel,
  guidedStepVisualState,
  listUsableModelProfileVersions,
  onboardingSearch,
  resolveOnboardingAgentVersionPath,
  visualStageDefinition,
  visualStagePrerequisitesMet,
  type GuidedVisualStageId,
  type NoCodeOnboardingStep,
  type OnboardingContext,
  type OnboardingProgressFlags,
  type OnboardingRunPhase,
} from "../../lib/agent-onboarding";
import type { AgentResource } from "../../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProfileVersionResource,
  ModelProviderConnectionResource,
} from "../../hooks/use-models";
import type { OsvaExampleCatalogEntry } from "../../lib/osva-examples-catalog";
import { LinkButton } from "../ui/button";
import { OnboardingExampleIdeasDialog } from "./onboarding-example-ideas-dialog";
import { OnboardingRecoveryDialog } from "./onboarding-recovery-dialog";

const REQUIRES_WRITE_ROLE =
  "This step requires DEVELOPER, ADMIN, or OWNER in this workspace.";
const REQUIRES_EXECUTE_ROLE =
  "This step requires OPERATOR, DEVELOPER, ADMIN, or OWNER.";

function readinessPillClass(state: SetupGuidanceState): string {
  switch (state) {
    case "verified_ready":
      return "onboarding-v2-pill-good";
    case "requires_setup":
      return "onboarding-v2-pill-warn";
    case "not_verifiable":
      return "onboarding-v2-pill-muted";
  }
}

function runPhaseUserLabel(phase: OnboardingRunPhase): string {
  switch (phase) {
    case "pending":
      return "Starting";
    case "queued":
      return "Waiting to run";
    case "running":
      return "Running now";
    case "succeeded":
      return "Finished successfully";
    case "failed":
      return "Did not finish";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "Timed out";
    case "not_in_loaded_page":
      return "Not in recent history";
    default:
      return "Not started yet";
  }
}

function runPhaseTechnicalLabel(phase: OnboardingRunPhase): string {
  switch (phase) {
    case "pending":
      return "PENDING";
    case "queued":
      return "QUEUED";
    case "running":
      return "RUNNING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "timed_out":
      return "TIMED_OUT";
    case "not_in_loaded_page":
      return "Not in loaded page";
    default:
      return "NONE";
  }
}

function isRunInProgress(phase: OnboardingRunPhase): boolean {
  return phase === "pending" || phase === "queued" || phase === "running";
}

function isRunTerminalFailure(phase: OnboardingRunPhase): boolean {
  return phase === "failed" || phase === "cancelled" || phase === "timed_out";
}

export function OnboardingStagePanel({
  stageId,
  flags,
  context,
  controlPlaneReachable,
  primaryGranularStep,
  recommendedStageId,
  canWrite,
  canExecute,
  agents,
  modelProfiles,
  modelProfileVersions,
  modelConnections,
  exampleEntry,
}: {
  readonly stageId: GuidedVisualStageId;
  readonly flags: OnboardingProgressFlags;
  readonly context: OnboardingContext;
  readonly controlPlaneReachable: boolean;
  readonly primaryGranularStep: NoCodeOnboardingStep | undefined;
  readonly recommendedStageId: GuidedVisualStageId;
  readonly canWrite: boolean;
  readonly canExecute: boolean;
  readonly agents: readonly AgentResource[] | undefined;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelProfileVersions:
    | ReadonlyArray<{
        readonly profileId: string;
        readonly versions: readonly ModelProfileVersionResource[];
      }>
    | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly exampleEntry: OsvaExampleCatalogEntry | undefined;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [runHelpOpen, setRunHelpOpen] = useState(false);

  const stage = visualStageDefinition(stageId);
  const prerequisitesMet = visualStagePrerequisitesMet(
    stageId,
    flags,
    controlPlaneReachable,
  );
  const versionPath = resolveOnboardingAgentVersionPath(context, flags);
  const runId = flags.onboardingRun?.id ?? context.runId;
  const runDetailPath =
    runId === undefined ? "/runs" : `/runs/${encodeURIComponent(runId)}`;

  const targetAgent =
    context.agentId !== undefined
      ? agents?.find((agent) => agent.id === context.agentId)
      : agents?.[0];

  const usableModels = listUsableModelProfileVersions({
    modelProfiles,
    modelProfileVersions,
  });

  const readinessItems = buildWorkspaceSetupGuidance({
    controlPlaneReachable,
    agents,
    modelProfiles,
    modelConnections,
    hasBoundProfileVersion: flags.modelReady,
  });

  const granular = primaryGranularStep;
  const statusDetail = granular?.statusDetail ?? stage.description;

  return (
    <article
      className="onboarding-v2-stage panel"
      data-testid="onboarding-primary-step"
      aria-labelledby="onboarding-stage-title"
    >
      <p className="onboarding-v2-stage-eyebrow">Stage {stage.index} of 4</p>
      <h2 className="onboarding-v2-stage-title" id="onboarding-stage-title">
        {stage.headline}
      </h2>
      <p className="onboarding-v2-stage-lead muted">{stage.description}</p>

      {stageId !== recommendedStageId ? (
        <div
          className="onboarding-v2-feedback onboarding-v2-feedback-info"
          role="status"
        >
          <strong>You&apos;re viewing an earlier step</strong>
          <p className="muted">
            Your current task is{" "}
            <strong>{visualStageDefinition(recommendedStageId).title}</strong>.
            Steps mark complete only when workspace data confirms it—not from
            navigation alone.
          </p>
        </div>
      ) : null}

      {!prerequisitesMet ? (
        <div
          className="onboarding-v2-feedback onboarding-v2-feedback-warn"
          role="status"
        >
          <strong>Complete earlier steps first</strong>
          <p className="muted">
            Verified setup from previous steps is still required before actions
            here will work.
          </p>
        </div>
      ) : null}

      {stageId === "get-ready" ? (
        <GetReadyBody
          items={readinessItems}
          progressLoadError={
            flags.progressIndeterminate && !controlPlaneReachable
          }
          onOpenHelp={() => {
            setHelpOpen(true);
          }}
        />
      ) : null}

      {stageId === "choose-model" ? (
        <ChooseModelBody
          usableModels={usableModels}
          connectionCount={modelConnections?.length ?? 0}
          profileCount={modelProfiles?.length ?? 0}
          canWrite={canWrite}
          onboardingContext={context}
        />
      ) : null}

      {stageId === "create-agent" ? (
        <CreateAgentBody
          targetAgent={targetAgent}
          exampleEntry={exampleEntry}
          canWrite={canWrite}
          context={context}
          onOpenIdeas={() => {
            setIdeasOpen(true);
          }}
        />
      ) : null}

      {stageId === "review-test" ? (
        <ReviewTestBody
          flags={flags}
          versionPath={versionPath}
          runDetailPath={runDetailPath}
          canWrite={canWrite}
          canExecute={canExecute}
          onOpenRunHelp={() => {
            setRunHelpOpen(true);
          }}
        />
      ) : null}

      <p className="onboarding-step-status" aria-live="polite">
        {granular !== undefined
          ? `${guidedStepVisualLabel(guidedStepVisualState(granular, flags))} — ${statusDetail}`
          : statusDetail}
      </p>

      {flags.runsListIncomplete && stageId === "review-test" ? (
        <p className="muted" role="status">
          Run history is paginated. Open Runs or add{" "}
          <span className="mono">runId</span> to the URL to track a specific
          Run.
        </p>
      ) : null}

      <OnboardingRecoveryDialog
        open={helpOpen}
        title="Guided troubleshooting"
        description="The Console can verify your session and workspace-scoped resources. It cannot independently prove PostgreSQL, Valkey, or worker health from the browser alone."
        onClose={() => {
          setHelpOpen(false);
        }}
      >
        <ul className="plain-list">
          <li>
            Confirm a workspace is selected and your role allows the action you
            need.
          </li>
          <li>
            If API requests fail, retry after the control plane is reachable
            again.
          </li>
          <li>
            Execution evidence comes from a terminal Run for your published
            AgentVersion—not from signing in.
          </li>
          <li>
            Workspace administrators can verify worker and database health
            outside the browser.
          </li>
        </ul>
      </OnboardingRecoveryDialog>

      <OnboardingExampleIdeasDialog
        open={ideasOpen}
        context={context}
        onClose={() => {
          setIdeasOpen(false);
        }}
      />

      <OnboardingRecoveryDialog
        open={runHelpOpen}
        title="Recover from a failed test Run"
        description="Failed, cancelled, and timed-out Runs keep their diagnostic history on Run Detail. Fix configuration or input, then start a new Run."
        onClose={() => {
          setRunHelpOpen(false);
        }}
      >
        <ul className="plain-list">
          <li>Confirm the model profile version bound at publish time.</li>
          <li>Review Run Detail for the terminal error and attempts.</li>
          <li>Adjust Agent Studio instructions or sample input, then retry.</li>
        </ul>
        <div className="toolbar">
          <Link className="button button-secondary" to={runDetailPath}>
            Open Run Detail
          </Link>
          <Link className="button" to={versionPath}>
            Back to AgentVersion
          </Link>
        </div>
      </OnboardingRecoveryDialog>
    </article>
  );
}

function GetReadyBody({
  items,
  progressLoadError,
  onOpenHelp,
}: {
  readonly items: ReturnType<typeof buildWorkspaceSetupGuidance>;
  readonly progressLoadError: boolean;
  readonly onOpenHelp: () => void;
}) {
  return (
    <>
      <p className="onboarding-v2-section-label">What we can verify</p>
      <ul className="onboarding-v2-check-list">
        {items.map((item) => (
          <li key={item.id} className="onboarding-v2-check-row">
            <div>
              <strong>{item.label}</strong>
              <p className="muted">{item.detail}</p>
            </div>
            <span
              className={`onboarding-v2-pill ${readinessPillClass(item.state)}`}
            >
              {setupGuidanceLabel(item.state)}
            </span>
          </li>
        ))}
      </ul>
      {progressLoadError ? (
        <div
          className="onboarding-v2-feedback onboarding-v2-feedback-warn"
          role="alert"
        >
          <strong>Could not verify progress</strong>
          <p className="muted">
            One or more workspace queries failed. Retry when the API is
            available.
          </p>
        </div>
      ) : null}
      <div className="toolbar">
        <button
          type="button"
          className="button button-secondary"
          onClick={onOpenHelp}
        >
          Show troubleshooting guide
        </button>
        <LinkButton variant="ghost" to="/select-workspace">
          Switch workspace
        </LinkButton>
      </div>
    </>
  );
}

function ChooseModelBody({
  usableModels,
  connectionCount,
  profileCount,
  canWrite,
  onboardingContext,
}: {
  readonly usableModels: ReturnType<typeof listUsableModelProfileVersions>;
  readonly connectionCount: number;
  readonly profileCount: number;
  readonly canWrite: boolean;
  readonly onboardingContext: OnboardingContext;
}) {
  const modelsLink = `/models`;
  const continuePath = `/onboarding${onboardingSearch(onboardingContext, {
    viewStage: "create-agent",
  })}`;
  if (usableModels.length > 0) {
    return (
      <>
        <p className="muted">
          These models are configured in your workspace. Agent Studio binds one
          when you create and publish your agent—not from this checklist alone.
        </p>
        <p className="onboarding-v2-section-label">Configured in workspace</p>
        <ul className="onboarding-v2-model-list">
          {usableModels.map((entry) => (
            <li key={entry.version.id} className="onboarding-v2-model-card">
              <div>
                <strong>{entry.profileName}</strong>
                <p className="muted">
                  {entry.version.provider} · {entry.version.model}
                </p>
              </div>
              <span className="onboarding-v2-pill onboarding-v2-pill-good">
                Configured
              </span>
            </li>
          ))}
        </ul>
        <details className="onboarding-technical-disclosure">
          <summary>Technical details</summary>
          <ul className="plain-list">
            {usableModels.map((entry) => (
              <li key={entry.version.id} className="mono">
                {entry.profileName} · profile version {entry.version.version} ·
                id {entry.version.id}
              </li>
            ))}
          </ul>
        </details>
        {canWrite ? (
          <div className="toolbar">
            <LinkButton variant="primary" to={continuePath}>
              Continue to agent creation
            </LinkButton>
            <LinkButton variant="secondary" to={modelsLink}>
              Open Models
            </LinkButton>
          </div>
        ) : (
          <p className="muted">{REQUIRES_WRITE_ROLE}</p>
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="onboarding-v2-feedback onboarding-v2-feedback-warn"
        role="status"
      >
        <strong>No model configured yet</strong>
        <p className="muted">
          {connectionCount === 0
            ? "Connect an AI provider on the Models page, then add a model your agents can use."
            : profileCount === 0
              ? "Provider connected. Create a model profile and save a version linked to that connection."
              : "Model profile exists but still needs a saved version linked to your provider connection."}
        </p>
      </div>
      {canWrite ? (
        <>
          <div className="toolbar">
            <LinkButton variant="primary" to={modelsLink}>
              Configure model
            </LinkButton>
          </div>
          <p className="muted onboarding-v2-footnote">
            Return here after saving:{" "}
            <Link
              className="mono"
              to={`/onboarding${onboardingSearch(onboardingContext, {
                viewStage: "choose-model",
              })}`}
            >
              guided setup · model stage
            </Link>
          </p>
        </>
      ) : (
        <p className="muted">{REQUIRES_WRITE_ROLE}</p>
      )}
    </>
  );
}

function CreateAgentBody({
  targetAgent,
  exampleEntry,
  canWrite,
  context,
  onOpenIdeas,
}: {
  readonly targetAgent: AgentResource | undefined;
  readonly exampleEntry: OsvaExampleCatalogEntry | undefined;
  readonly canWrite: boolean;
  readonly context: OnboardingContext;
  readonly onOpenIdeas: () => void;
}) {
  const studioPath =
    context.agentId !== undefined
      ? `/agents/${encodeURIComponent(context.agentId)}`
      : "/agents/new";

  return (
    <>
      {targetAgent !== undefined ? (
        <div
          className="onboarding-v2-feedback onboarding-v2-feedback-good"
          role="status"
        >
          <strong>Agent registered</strong>
          <p className="muted">
            <span className="mono">{targetAgent.name}</span> exists in this
            workspace. Publish your agent in the next step when you are ready.
          </p>
        </div>
      ) : (
        <p className="muted">
          Open Agent Studio to name your agent and describe what it should
          accomplish. You can add tools, knowledge, and memory later.
        </p>
      )}
      {exampleEntry !== undefined ? (
        <p className="muted">
          Example context: <strong>{exampleEntry.title}</strong> — use it as
          inspiration; it is not an automatic import.
        </p>
      ) : null}
      <div className="toolbar">
        {canWrite ? (
          <>
            <LinkButton variant="primary" to={studioPath}>
              {targetAgent !== undefined ? "Open Agent Studio" : "Create Agent"}
            </LinkButton>
            <button
              type="button"
              className="button button-secondary"
              onClick={onOpenIdeas}
            >
              Example ideas
            </button>
          </>
        ) : (
          <p className="muted">{REQUIRES_WRITE_ROLE}</p>
        )}
      </div>
    </>
  );
}

function ReviewTestBody({
  flags,
  versionPath,
  runDetailPath,
  canWrite,
  canExecute,
  onOpenRunHelp,
}: {
  readonly flags: OnboardingProgressFlags;
  readonly versionPath: string;
  readonly runDetailPath: string;
  readonly canWrite: boolean;
  readonly canExecute: boolean;
  readonly onOpenRunHelp: () => void;
}) {
  const published = flags.publishedVersionReady;
  const runSubmitted = flags.sampleRunSubmitted;
  const succeeded = flags.sampleRunSucceeded;
  const phase = flags.runPhase;
  const inProgress = runSubmitted && !succeeded && isRunInProgress(phase);
  const terminalFailure = runSubmitted && isRunTerminalFailure(phase);
  const runProgressMessage =
    phase === "queued" || phase === "pending"
      ? "Your test is waiting to start."
      : phase === "running"
        ? "Your agent is working on the test."
        : undefined;

  return (
    <>
      <div className="onboarding-v2-review-grid">
        <div className="onboarding-v2-review-card">
          <h3 className="onboarding-v2-review-title">Publish</h3>
          <p className="muted">
            Save a published version of your agent. Publishing does not run the
            test for you.
          </p>
          <p className="onboarding-v2-pill-line">
            Status:{" "}
            <span
              className={`onboarding-v2-pill ${published ? "onboarding-v2-pill-good" : "onboarding-v2-pill-warn"}`}
            >
              {published ? "Ready to test" : "Not published yet"}
            </span>
          </p>
          {canWrite ? (
            <LinkButton variant="secondary" to={versionPath}>
              Review and publish
            </LinkButton>
          ) : (
            <p className="muted">{REQUIRES_WRITE_ROLE}</p>
          )}
        </div>
        <div className="onboarding-v2-review-card">
          <h3 className="onboarding-v2-review-title">Test your agent</h3>
          <p className="muted">
            Send a small sample task. You will know it worked when the test
            finishes successfully.
          </p>
          <p
            className="onboarding-v2-pill-line"
            data-testid="onboarding-run-status"
            data-run-phase={runPhaseTechnicalLabel(phase)}
          >
            Status:{" "}
            <span
              className={`onboarding-v2-pill ${
                succeeded
                  ? "onboarding-v2-pill-good"
                  : terminalFailure
                    ? "onboarding-v2-pill-bad"
                    : inProgress
                      ? "onboarding-v2-pill-info"
                      : "onboarding-v2-pill-muted"
              }`}
            >
              {succeeded ? "Finished successfully" : runPhaseUserLabel(phase)}
            </span>
          </p>
          {inProgress && runProgressMessage !== undefined ? (
            <div
              className="onboarding-v2-feedback onboarding-v2-feedback-info"
              role="status"
              data-testid="onboarding-run-progress-message"
            >
              <p className="muted">{runProgressMessage}</p>
              <p className="muted">
                Open run details to watch progress—this is normal, not a
                failure.
              </p>
            </div>
          ) : null}
          {canExecute ? (
            <div className="toolbar">
              {!inProgress && !succeeded ? (
                <LinkButton variant="primary" to={versionPath}>
                  Start test run
                </LinkButton>
              ) : null}
              {runSubmitted ? (
                <LinkButton variant="secondary" to={runDetailPath}>
                  Open run details
                </LinkButton>
              ) : null}
            </div>
          ) : (
            <p className="muted">{REQUIRES_EXECUTE_ROLE}</p>
          )}
          <details className="onboarding-technical-disclosure">
            <summary>Technical status</summary>
            <p className="muted mono">
              Run lifecycle: {runPhaseTechnicalLabel(phase)}
            </p>
          </details>
        </div>
      </div>

      {terminalFailure ? (
        <div
          className="onboarding-v2-feedback onboarding-v2-feedback-warn"
          role="status"
          data-testid="onboarding-run-failure-recovery"
        >
          <strong>Test did not succeed</strong>
          <p className="muted">
            Review what happened on run details, adjust your agent or model if
            needed, then start a new test run.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={onOpenRunHelp}
          >
            Show recovery steps
          </button>
        </div>
      ) : null}
    </>
  );
}
