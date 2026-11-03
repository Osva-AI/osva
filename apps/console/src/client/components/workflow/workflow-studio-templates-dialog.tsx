import { OnboardingRecoveryDialog } from "../onboarding/onboarding-recovery-dialog";
import { Button } from "../ui/button";
import {
  WORKFLOW_BUILDER_TEMPLATES,
  type WorkflowBuilderTemplateId,
} from "../../lib/workflow-builder-templates";
import { workflowNodePresentation } from "../../lib/workflow-node-catalog";

function templateStepSummary(templateId: WorkflowBuilderTemplateId): string {
  const template = WORKFLOW_BUILDER_TEMPLATES.find(
    (entry) => entry.id === templateId,
  );
  if (template === undefined) {
    return "";
  }
  const types = [
    ...new Set(template.definition.nodes.map((node) => node.type)),
  ];
  return types.map((type) => workflowNodePresentation(type).label).join(" · ");
}

export function WorkflowStudioTemplatesDialog({
  open,
  onClose,
  onApply,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApply: (templateId: WorkflowBuilderTemplateId) => void;
}) {
  return (
    <OnboardingRecoveryDialog
      open={open}
      title="Workflow templates"
      description="Starter graphs use supported Workflow V3 step types only. Applying a template fills your draft—nothing is published until you review and confirm."
      onClose={onClose}
    >
      <ul className="workflow-studio-template-list">
        <li className="workflow-studio-template-card">
          <div>
            <strong>Start from blank</strong>
            <p className="muted">
              An empty canvas. Add steps from the palette and connect them.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Use blank canvas
          </Button>
        </li>
        {WORKFLOW_BUILDER_TEMPLATES.map((template) => (
          <li key={template.id} className="workflow-studio-template-card">
            <div>
              <strong>{template.name}</strong>
              <p className="muted">{template.description}</p>
              <p className="muted workflow-studio-template-steps">
                Includes: {templateStepSummary(template.id)}. You still need to
                bind agent versions and fix validation issues before publishing.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              data-testid={`workflow-template-apply-${template.id}`}
              onClick={() => {
                onApply(template.id);
                onClose();
              }}
            >
              Apply template
            </Button>
          </li>
        ))}
      </ul>
    </OnboardingRecoveryDialog>
  );
}
