import {
  CONNECTOR_SETUP_STEPS,
  describeSetupStepVisualState,
  resolveSetupStepVisualState,
  type ConnectorSetupStepId,
  type ConnectorSetupStepVisualState,
} from "../../lib/connector-guided-setup";
import type { CatalogWorkspaceIntegrationStatus } from "../../lib/connector-workspace-status";
import type { ConnectorCatalogTransport } from "../../lib/osva-connectors-catalog";
import type { ConnectorVersionResource } from "../../hooks/use-tools-connectors";

export function ConnectorGuidedSetupStepper(props: {
  readonly focusStepId: ConnectorSetupStepId;
  readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
  readonly transport: ConnectorCatalogTransport;
  readonly linkedVersions: readonly ConnectorVersionResource[];
  readonly onStepFocus: (stepId: ConnectorSetupStepId) => void;
}) {
  return (
    <nav
      className="onboarding-guided-stepper"
      aria-label="Connector setup progress"
      data-testid="connector-guided-setup-stepper"
    >
      <ol className="onboarding-guided-stepper-list">
        {CONNECTOR_SETUP_STEPS.map((step, index) => {
          const visual = resolveSetupStepVisualState(step.id, {
            integrationStatus: props.integrationStatus,
            transport: props.transport,
            linkedVersions: props.linkedVersions,
            focusStepId: props.focusStepId,
          });
          const isCurrent =
            visual === "current" || visual === "needs_attention";
          return (
            <li
              key={step.id}
              className={`onboarding-guided-step onboarding-guided-step-${visual}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <button
                type="button"
                className="connector-guided-setup-step-button"
                onClick={() => props.onStepFocus(step.id)}
                aria-label={`${step.title}: ${describeSetupStepVisualState(visual)}`}
              >
                <span
                  className="onboarding-guided-step-index"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="onboarding-guided-step-body">
                  <span className="onboarding-guided-step-title">
                    {step.title}
                  </span>
                  <span className="onboarding-guided-step-state">
                    {describeSetupStepVisualState(visual)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function setupStepVisualForTest(
  stepId: ConnectorSetupStepId,
  integrationStatus: CatalogWorkspaceIntegrationStatus,
  transport: ConnectorCatalogTransport,
  linkedVersions: readonly ConnectorVersionResource[],
  focusStepId: ConnectorSetupStepId,
): ConnectorSetupStepVisualState {
  return resolveSetupStepVisualState(stepId, {
    integrationStatus,
    transport,
    linkedVersions,
    focusStepId,
  });
}
