import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";

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
  useActivateWorkspaceInferenceBudgetMutation,
  useAppendInferenceBudgetPolicyVersionMutation,
  useInferenceBudgetPoliciesListQuery,
  useInferenceBudgetPolicyVersionsQuery,
  useWorkspaceInferenceBudgetConfigurationQuery,
} from "../hooks/use-inference-budget";
import { ConsoleApiError } from "../lib/console-api";
import {
  formatUsdMicrosForDisplay,
  parseUsdInputToMicros,
} from "../lib/inference-budget-presentation";
import { roleCanAdminControlPlaneResources } from "../lib/permissions";
import { summarizePolicyPeriodLimit } from "./inference-budget-page";

export function InferenceBudgetPolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const authQuery = useAuthContextQuery();
  const policiesQuery = useInferenceBudgetPoliciesListQuery();
  const versionsQuery = useInferenceBudgetPolicyVersionsQuery(policyId);
  const appendMutation = useAppendInferenceBudgetPolicyVersionMutation(
    policyId ?? "",
  );
  const configQuery = useWorkspaceInferenceBudgetConfigurationQuery();
  const activateMutation = useActivateWorkspaceInferenceBudgetMutation();

  const latestDefinition = useMemo(() => {
    const versions = versionsQuery.data?.versions ?? [];
    if (versions.length === 0) {
      return createDefaultInferenceBudgetPolicyDefinition();
    }
    const latest = [...versions].sort((a, b) => b.version - a.version)[0];
    return latest?.definition ?? createDefaultInferenceBudgetPolicyDefinition();
  }, [versionsQuery.data?.versions]);

  const [periodLimitUsd, setPeriodLimitUsd] = useState("");
  const [appendMessage, setAppendMessage] = useState<string | undefined>();
  const [appendError, setAppendError] = useState<string | undefined>();
  const [pendingActivateVersionId, setPendingActivateVersionId] = useState<
    string | undefined
  >();
  const [activateError, setActivateError] = useState<string | undefined>();

  const activationMutationsPermitted =
    configQuery.data?.activationMutationsPermitted === true;
  const activeVersionId =
    configQuery.data?.activation.activePolicyVersionId ?? undefined;

  const canAdmin =
    authQuery.data !== undefined &&
    roleCanAdminControlPlaneResources(authQuery.data.role);

  if (policyId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing policyId.")}
      />
    );
  }

  const policy = policiesQuery.data?.policies.find((p) => p.id === policyId);

  return (
    <div
      className="page-stack"
      data-testid="inference-budget-policy-detail-page"
    >
      <PageHeader
        title={policy?.key ?? "Inference budget policy"}
        subtitle="Immutable version history. Appending a version does not enable enforcement."
        actions={
          <LinkButton variant="secondary" to="/settings/inference-budget">
            Back to inference budget
          </LinkButton>
        }
      />

      <details className="models-v2-tech-details">
        <summary>Technical identifiers</summary>
        <dl className="meta-list">
          <div>
            <dt>Policy ID</dt>
            <dd className="mono">{policyId}</dd>
          </div>
        </dl>
      </details>

      {versionsQuery.isLoading ? (
        <LoadingBlock label="Loading versions" />
      ) : null}
      {versionsQuery.isError ? (
        <ErrorState title="Versions" error={versionsQuery.error} />
      ) : null}

      {versionsQuery.data !== undefined ? (
        <SectionPanel title="Version history">
          <DataTableRegion caption="Policy versions">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Period limit</th>
                <th scope="col">Created</th>
                <th scope="col">Version ID</th>
                {canAdmin && activationMutationsPermitted ? (
                  <th scope="col">Enforcement</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {(versionsQuery.data?.versions ?? []).map((version) => (
                <tr key={version.id}>
                  <td>v{version.version}</td>
                  <td>{summarizePolicyPeriodLimit(version.definition)}</td>
                  <td>{version.createdAt}</td>
                  <td className="mono">{version.id}</td>
                  {canAdmin && activationMutationsPermitted ? (
                    <td>
                      {activeVersionId === version.id ? (
                        <span className="muted">Active</span>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          data-testid={`inference-budget-activate-${version.id}`}
                          loading={
                            activateMutation.isPending &&
                            pendingActivateVersionId === version.id
                          }
                          disabled={activateMutation.isPending}
                          onClick={() => {
                            setActivateError(undefined);
                            setPendingActivateVersionId(version.id);
                          }}
                        >
                          Enable enforcement
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </DataTableRegion>
        </SectionPanel>
      ) : null}

      {!canAdmin ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">
            Only workspace ADMIN can append a new policy version.
          </p>
        </section>
      ) : null}

      {activateError !== undefined ? (
        <p className="form-error" role="alert">
          {activateError}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingActivateVersionId !== undefined}
        title="Enable budget enforcement?"
        description="This pins the selected immutable policy version for the workspace. Reservations are accounted before provider I/O; provider billing may exceed estimates."
        confirmLabel="Enable enforcement"
        pending={activateMutation.isPending}
        onCancel={() => {
          if (!activateMutation.isPending) {
            setPendingActivateVersionId(undefined);
          }
        }}
        onConfirm={() => {
          if (pendingActivateVersionId === undefined) {
            return;
          }
          const versionId = pendingActivateVersionId;
          void activateMutation
            .mutateAsync({ policyVersionId: versionId })
            .then(() => {
              setPendingActivateVersionId(undefined);
              setActivateError(undefined);
            })
            .catch((error: unknown) => {
              const message =
                error instanceof ConsoleApiError
                  ? error.message
                  : "Failed to enable enforcement.";
              setActivateError(message);
              setPendingActivateVersionId(undefined);
            });
        }}
      />

      {canAdmin ? (
        <SectionPanel
          title="Append policy version"
          description={`Next version starts from v${String((versionsQuery.data?.versions.length ?? 0) + 1)}. Prior versions remain unchanged.`}
        >
          <p className="muted">
            Current latest period limit:{" "}
            {formatUsdMicrosForDisplay(latestDefinition.periodLimitUsdMicros)}
          </p>
          <TextField
            id="inference-budget-append-period-limit"
            label="New period limit (USD)"
            hint="Leave blank to reuse the latest limit."
            value={periodLimitUsd}
            onChange={(event) => {
              setPeriodLimitUsd(event.target.value);
              setAppendError(undefined);
              setAppendMessage(undefined);
            }}
          />
          {appendError !== undefined ? (
            <p className="form-error" role="alert">
              {appendError}
            </p>
          ) : null}
          {appendMessage !== undefined ? (
            <p className="models-v2-success" role="status">
              {appendMessage}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={appendMutation.isPending}
            disabled={appendMutation.isPending}
            onClick={() => {
              let micros = latestDefinition.periodLimitUsdMicros;
              if (periodLimitUsd.trim().length > 0) {
                const parsed = parseUsdInputToMicros(periodLimitUsd);
                if (parsed === undefined) {
                  setAppendError(
                    "Enter a valid USD amount (up to six decimal places).",
                  );
                  return;
                }
                micros = parsed;
              }
              void appendMutation
                .mutateAsync({
                  definition: {
                    ...latestDefinition,
                    periodLimitUsdMicros: micros,
                  },
                })
                .then((created) => {
                  setAppendMessage(
                    `Appended version v${String(created.version)} (${created.id}).`,
                  );
                  setPeriodLimitUsd("");
                  setAppendError(undefined);
                })
                .catch((error: unknown) => {
                  setAppendMessage(undefined);
                  setAppendError(
                    error instanceof ConsoleApiError
                      ? error.message
                      : "Failed to append version.",
                  );
                });
            }}
          >
            Append version
          </Button>
        </SectionPanel>
      ) : null}
    </div>
  );
}
