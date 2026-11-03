import { OnboardingRecoveryDialog } from "../onboarding/onboarding-recovery-dialog";
import { AGENT_STUDIO_TEMPLATE_IDEAS } from "../../lib/agent-studio-v2-templates";
import { Button } from "../ui/button";

export function AgentStudioTemplatesDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApply: (templateId: string) => void;
}) {
  return (
    <OnboardingRecoveryDialog
      open={props.open}
      title="Template ideas (text pre-fill only)"
      description="These starter ideas fill a name and instructions. You still need to choose a model and publish before the agent can run."
      onClose={props.onClose}
    >
      <ul className="agent-studio-v2-template-list">
        {AGENT_STUDIO_TEMPLATE_IDEAS.map((idea) => (
          <li key={idea.id} className="agent-studio-v2-template-card">
            <div>
              <strong>{idea.title}</strong>
              <p className="muted">{idea.description}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                props.onApply(idea.id);
                props.onClose();
              }}
            >
              Use this idea
            </Button>
          </li>
        ))}
      </ul>
    </OnboardingRecoveryDialog>
  );
}
