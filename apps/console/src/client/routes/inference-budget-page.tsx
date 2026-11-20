import { useState } from "react";
import { Link } from "react-router-dom";
import {
  createDefaultInferenceBudgetPolicyDefinition,
  type InferenceBudgetPeriodKeyV1,
} from "@osva-ai/contracts";

import { PeriodLedgerPanel } from "../components/inference-budget/period-ledger-panel";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateInferenceBudgetPolicyMutation,
  useDisableWorkspaceInferenceBudgetMutation,
  useInferenceBudgetPeriodUsageQuery,
  useInferenceBudgetPoliciesListQuery,
  useWorkspaceInferenceBudgetConfigurationQuery,
} from "../hooks/use-inference-budget";
import { ConsoleApiError } from "../lib/console-api";
import {
  derivePreviousUtcPeriodKey,
  formatUsdMicrosForDisplay,
  parseUsdInputToMicros,
} from "../lib/inference-budget-presentation";
import { roleCanAdminControlPlaneResources } from "../lib/permissions";

export function InferenceBudgetPage() {
  const authQuery = useAuthContextQuery();
  const policiesQuery = useInferenceBudgetPoliciesListQuery();
  const configQuery = useWorkspaceInferenceBudgetConfigurationQuery();
  const currentUsageQuery = useInferenceBudgetPeriodUsageQuery();
  const previousPeriodKey =
    currentUsageQuery.data?.period.periodKey !== undefined
      ? derivePreviousUtcPeriodKey(currentUsageQuery.data.period.periodKey)
      : undefined;
  const previousUsageQuery = useInferenceBudgetPeriodUsageQuery(
    previousPeriodKey as InferenceBudgetPeriodKeyV1 | undefined,
    { enabled: previousPeriodKey !== undefined },
  );
  const createMutation = useCreateInferenceBudgetPolicyMutation();
  const disableMutation = useDisableWorkspaceInferenceBudgetMutation();

  const [policyKey, setPolicyKey] = useState("");
  const [periodLimitUsd, setPeriodLimitUsd] = useState("100.00");
  const [formError, setFormError] = useState<string | undefined>();
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [activationActionError, setActivationActionError] = useState<
    string | undefined
  >();

  const role = authQuery.data?.role;
  const canAdmin =
    role !== undefined && roleCanAdminControlPlaneResources(role);
  const activationEnabled = configQuery.data?.activation.enabled === true;
  const activationMutationsPermitted =
    configQuery.data?.activationMutationsPermitted === true;
  const activeVersionId =
    configQuery.data?.activation.activePolicyVersionId ?? undefined;

  return (
    <div className="page-stack activity-v2" data-testid="inference-budget-page">
      <PageHeader
        title="Inference budget"
        subtitle="Define reservation policies, activate version-pinned enforcement when permitted by deployment, and review estimated workspace liability."
        actions={
          <LinkButton variant="secondary" to="/settings">
            Back to settings
          </LinkButton>
        }
      />

      {activationEnabled ? (
        <section
          className="activity-v2-success inference-budget-enforcement-banner"
          role="status"
          data-testid="inference-budget-enforcement-active"
        >
          <p className="activity-v2-success-title">
            Budget enforcement is active.
          </p>
          <p className="muted">
            Reservations are accounted before provider I/O. Estimated limits do
            not guarantee provider invoices; disabling does not erase recorded
            charges.
          </p>
        </section>
      ) : (
        <section
          className="activity-v2-degraded inference-budget-enforcement-banner"
          role="status"
          data-testid="inference-budget-enforcement-disabled"
        >
          <p className="activity-v2-degraded-title">
            Budget enforcement is not enabled.
          </p>
          <p className="muted">
            {activationMutationsPermitted
              ? "Select a policy version on the policy detail page and enable enforcement when ready."
              : "Activation mutations are disabled on this deployment (OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED). Policies and usage remain readable."}
          </p>
        </section>
      )}

      {!activationMutationsPermitted ? (
        <section
          className="activity-v2-degraded"
          role="status"
          data-testid="inference-budget-activation-gate-disabled"
        >
          <p className="activity-v2-degraded-title">
            Activation controls unavailable
          </p>
          <p className="muted">
            The server does not permit workspace activation mutations. This is
            the default production posture.
          </p>
        </section>
      ) : null}

      {configQuery.isLoading ? (
        <LoadingBlock label="Loading configuration" />
      ) : null}
      {configQuery.isError ? (
        <ErrorState title="Configuration" error={configQuery.error} />
      ) : null}
      {configQuery.data !== undefined ? (
        <SectionPanel
          title="Workspace configuration"
          description="Read-only activation state from the control plane."
        >
          <dl className="meta-list">
            <div>
              <dt>Activation enabled</dt>
              <dd>{configQuery.data.activation.enabled ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Active policy version</dt>
              <dd className="mono">
                {configQuery.data.activation.activePolicyVersionId ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Runtime policy enabled</dt>
              <dd>{configQuery.data.runtimePolicy.enabled ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Activation mutations permitted</dt>
              <dd>
                {configQuery.data.activationMutationsPermitted ? "Yes" : "No"}
              </dd>
            </div>
          </dl>
          {activationActionError !== undefined ? (
            <p className="form-error" role="alert">
              {activationActionError}
            </p>
          ) : null}
          {canAdmin &&
          activationMutationsPermitted &&
          activationEnabled &&
          activeVersionId !== undefined ? (
            <Button
              type="button"
              variant="secondary"
              data-testid="inference-budget-disable-enforcement"
              loading={disableMutation.isPending}
              disabled={disableMutation.isPending}
              onClick={() => {
                setActivationActionError(undefined);
                setDisableConfirmOpen(true);
              }}
            >
              Disable enforcement
            </Button>
          ) : null}
        </SectionPanel>
      ) : null}

      <ConfirmDialog
        open={disableConfirmOpen}
        title="Disable budget enforcement?"
        description="Outstanding reservations and ledger liability remain. New runs will not admit against the budget until you activate a version again."
        confirmLabel="Disable enforcement"
        destructive
        pending={disableMutation.isPending}
        onCancel={() => {
          if (!disableMutation.isPending) {
            setDisableConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          void disableMutation
            .mutateAsync()
            .then(() => {
              setDisableConfirmOpen(false);
              setActivationActionError(undefined);
            })
            .catch((error: unknown) => {
              const message =
                error instanceof ConsoleApiError
                  ? error.message
                  : "Failed to disable enforcement.";
              setActivationActionError(message);
              setDisableConfirmOpen(false);
            });
        }}
      />

      <PeriodLedgerPanel
        title="Current UTC period"
        usage={currentUsageQuery.data}
        isLoading={currentUsageQuery.isLoading}
        error={currentUsageQuery.error}
        emptyLabel="No ledger row for this UTC period yet. Usage appears after admitted reservations exist."
      />

      {previousPeriodKey !== undefined ? (
        <PeriodLedgerPanel
          title="Previous UTC period"
          usage={previousUsageQuery.data}
          isLoading={previousUsageQuery.isLoading}
          error={previousUsageQuery.error}
          emptyLabel="No historical ledger for the previous UTC period."
        />
      ) : null}

      {!canAdmin ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">
            Only workspace ADMIN can create policies or append versions.
          </p>
        </section>
      ) : null}

      {canAdmin ? (
        <SectionPanel
          title="Create policy"
          description="Creates an immutable version 1. New versions do not activate automatically."
        >
          <div className="filters models-v2-filters">
            <TextField
              id="inference-budget-policy-key"
              label="Policy key"
              required
              value={policyKey}
              onChange={(event) => {
                setPolicyKey(event.target.value);
                setFormError(undefined);
              }}
              placeholder="default"
            />
            <TextField
              id="inference-budget-period-limit"
              label="Period limit (USD)"
              hint="Stored as integer micro-dollars; display is rounded."
              required
              value={periodLimitUsd}
              onChange={(event) => {
                setPeriodLimitUsd(event.target.value);
                setFormError(undefined);
              }}
            />
          </div>
          {formError !== undefined ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={createMutation.isPending}
            disabled={createMutation.isPending || policyKey.trim().length === 0}
            onClick={() => {
              const micros = parseUsdInputToMicros(periodLimitUsd);
              if (micros === undefined) {
                setFormError(
                  "Enter a valid USD amount (up to six decimal places).",
                );
                return;
              }
              void createMutation
                .mutateAsync({
                  key: policyKey.trim(),
                  definition: {
                    ...createDefaultInferenceBudgetPolicyDefinition(),
                    periodLimitUsdMicros: micros,
                  },
                })
                .then(() => {
                  setPolicyKey("");
                  setFormError(undefined);
                })
                .catch((error: unknown) => {
                  const message =
                    error instanceof ConsoleApiError
                      ? error.message
                      : "Failed to create policy.";
                  setFormError(message);
                });
            }}
          >
            Create policy
          </Button>
        </SectionPanel>
      ) : null}

      <SectionPanel title="Policies">
        {policiesQuery.isLoading ? (
          <LoadingBlock label="Loading policies" />
        ) : null}
        {policiesQuery.isError ? (
          <ErrorState title="Policies" error={policiesQuery.error} />
        ) : null}
        {policiesQuery.data !== undefined ? (
          <DataTableRegion caption="Inference budget policies">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {policiesQuery.data.policies.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No inference budget policies yet.
                  </td>
                </tr>
              ) : (
                policiesQuery.data.policies.map((policy) => (
                  <tr key={policy.id}>
                    <td>
                      <Link to={`/settings/inference-budget/${policy.id}`}>
                        {policy.key}
                      </Link>
                    </td>
                    <td className="mono">{policy.key}</td>
                    <td>{policy.createdAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTableRegion>
        ) : null}
      </SectionPanel>
    </div>
  );
}

export function summarizePolicyPeriodLimit(definition: {
  readonly periodLimitUsdMicros: number;
}): string {
  return formatUsdMicrosForDisplay(definition.periodLimitUsdMicros);
}
