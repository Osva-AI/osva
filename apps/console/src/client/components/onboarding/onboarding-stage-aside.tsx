import type { GuidedVisualStageId } from "../../lib/agent-onboarding";
import { visualStageDefinition } from "../../lib/agent-onboarding";

const STAGE_HELP: Record<
  GuidedVisualStageId,
  { readonly title: string; readonly body: string }
> = {
  "get-ready": {
    title: "Why this check matters",
    body: "Signing in proves your Console session—not that every backend service is healthy. We label what is verified versus not independently verifiable.",
  },
  "choose-model": {
    title: "About model binding",
    body: "Declarative agents bind an immutable ModelProfileVersion at publish time. A provider connection alone is not enough until a profile version references a connection version.",
  },
  "create-agent": {
    title: "Agent Studio",
    body: "Agent Studio holds instructions and optional capabilities. Drafts are not published versions—you explicitly publish when ready.",
  },
  "review-test": {
    title: "Publish vs test",
    body: "Publishing records configuration. Testing executes a Run through the worker. Only SUCCEEDED confirms the sample task completed.",
  },
};

export function OnboardingStageAside({
  stageId,
}: {
  readonly stageId: GuidedVisualStageId;
}) {
  const stage = visualStageDefinition(stageId);
  const help = STAGE_HELP[stageId];

  return (
    <aside className="onboarding-v2-aside" aria-label="Contextual help">
      <div className="onboarding-v2-aside-box">
        <p className="onboarding-v2-aside-eyebrow">Context</p>
        <h3 className="onboarding-v2-aside-title">{stage.title}</h3>
        <p className="muted">{help.body}</p>
      </div>
      <div className="onboarding-v2-aside-box">
        <p className="onboarding-v2-aside-eyebrow">Tip</p>
        <p className="muted">{help.title}</p>
      </div>
    </aside>
  );
}
