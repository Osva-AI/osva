import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { ConnectorGuidedSetupStepper } from "../components/connectors/connector-guided-setup-stepper";
import { ConnectorSetupCopyableCommand } from "../components/connectors/connector-setup-copyable-command";
import {
  ConnectorTransportBadge,
  ConnectorWorkspaceStatusBadge,
} from "../components/connectors/connector-catalog-badges";
import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useConnectorCatalogWorkspaceStatus } from "../hooks/use-connector-catalog-workspace";
import {
  useConnectorVersionsQuery,
  useCreateConnectorMutation,
} from "../hooks/use-tools-connectors";
import {
  buildVerifiedWorkerPackageInstallCommand,
  CONNECTOR_SETUP_STEPS,
  connectorDiscoverHandoffPath,
  describeAuthenticationGuidance,
  describeJourneyEvidenceLabel,
  describeNodeRuntimeRequirement,
  describeStdioOperatorBoundary,
  deriveRecommendedSetupStep,
  mapIntegrationStatusToJourneyLabel,
  parseSetupStepId,
  streamableHttpOfferedForCatalogTransport,
  type ConnectorSetupStepId,
} from "../lib/connector-guided-setup";
import type { CatalogWorkspaceIntegrationStatus } from "../lib/connector-workspace-status";
import {
  getConnectorCatalogEntry,
  type ConnectorCatalogEntry,
} from "../lib/osva-connectors-catalog";
import type { ConnectorVersionResource } from "../hooks/use-tools-connectors";
import {
  isAllowedOsvaConnectorsUrl,
  OSVA_CONNECTORS_AUDITED_SHA,
} from "../lib/osva-connectors-links";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import {
  describeIntegrationsWriteRoleRequirement,
  formatConnectorVersionOption,
  formatTransportLabel,
} from "../lib/tool-resource-presentation";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function ConnectorCatalogSetupPage() {
  const { catalogConnectorId } = useParams<{ catalogConnectorId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const entry = getConnectorCatalogEntry(catalogConnectorId ?? "");
  const workspaceStatus = useConnectorCatalogWorkspaceStatus(entry);
  const createMutation = useCreateConnectorMutation();
  const [createError, setCreateError] = useState<string | undefined>();
  const [connectorName, setConnectorName] = useState(
    () => entry?.shortTitle ?? "",
  );

  const integrationStatus = workspaceStatus?.status ?? "catalog-only";
  const workspaceConnectorId = workspaceStatus?.workspaceConnectorId;
  const versionsQuery = useConnectorVersionsQuery(workspaceConnectorId);
  const linkedVersions = versionsQuery.data?.versions ?? [];

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const recommendedStep = deriveRecommendedSetupStep(integrationStatus);
  const queryStep = parseSetupStepId(searchParams.get("step"));
  const focusStepId = queryStep ?? recommendedStep;

  const journeyLabel = mapIntegrationStatusToJourneyLabel(integrationStatus);
  const journeyEvidence =
    integrationStatus === "tools-imported"
      ? describeJourneyEvidenceLabel("ready-for-agent-binding")
      : describeJourneyEvidenceLabel(journeyLabel);

  const stepMeta = useMemo(
    () => CONNECTOR_SETUP_STEPS.find((step) => step.id === focusStepId),
    [focusStepId],
  );

  useEffect(() => {
    if (entry !== undefined) {
      setConnectorName(entry.shortTitle);
    }
  }, [entry?.connectorId, entry?.shortTitle]);

  function setFocusStep(stepId: ConnectorSetupStepId): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("step", stepId);
        return next;
      },
      { replace: true },
    );
  }

  if (catalogConnectorId === undefined) {
    return <Navigate to="/tools/connectors/catalog" replace />;
  }

  if (entry === undefined) {
    return (
      <>
        <PageHeader title="Connector not in catalog" />
        <EmptyState
          title="Unknown catalog connector"
          description="Only published osva-connectors packages in the pinned snapshot are listed."
        />
        <LinkButton variant="primary" to="/tools/connectors/catalog">
          Browse catalog
        </LinkButton>
      </>
    );
  }

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to continue setup." />;
  }

  const installAllowed = isAllowedOsvaConnectorsUrl(entry.installGuideUrl);

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="connector-catalog-setup-page"
    >
      <PageHeader
        title={`Set up ${entry.shortTitle}`}
        subtitle="Guided workspace setup for a published connector package"
        actions={
          <>
            <LinkButton
              variant="secondary"
              to={`/tools/connectors/catalog/${catalogConnectorId}`}
            >
              Catalog detail
            </LinkButton>
            <LinkButton variant="secondary" to="/tools/connectors/catalog">
              Back to catalog
            </LinkButton>
          </>
        }
      />

      <IntegrationsSectionNav active="catalog" />

      <p
        className="muted"
        role="status"
        data-testid="connector-setup-journey-status"
      >
        {journeyEvidence}
      </p>

      <div className="example-badge-row">
        <ConnectorTransportBadge transport={entry.mcpTransport} />
        {workspaceStatus !== undefined ? (
          <ConnectorWorkspaceStatusBadge status={workspaceStatus.status} />
        ) : null}
      </div>

      <ConnectorGuidedSetupStepper
        focusStepId={focusStepId}
        integrationStatus={integrationStatus}
        transport={entry.mcpTransport}
        linkedVersions={linkedVersions}
        onStepFocus={setFocusStep}
      />

      <div data-testid="connector-setup-active-step" data-step={focusStepId}>
        <SectionPanel
          title={stepMeta?.title ?? "Setup"}
          description={stepMeta?.summary}
          className="connector-setup-primary-panel"
        >
          <SetupStepPanel
            stepId={focusStepId}
            entry={entry}
            canWrite={canWrite}
            integrationStatus={integrationStatus}
            workspaceConnectorId={workspaceConnectorId}
            linkedVersions={linkedVersions}
            versionsLoading={versionsQuery.isLoading}
            installAllowed={installAllowed}
            connectorName={connectorName}
            onConnectorNameChange={setConnectorName}
            createPending={createMutation.isPending}
            createError={createError}
            onCreateConnector={() => {
              setCreateError(undefined);
              void createMutation
                .mutateAsync({
                  key: entry.connectorKey,
                  name:
                    connectorName.trim().length > 0
                      ? connectorName.trim()
                      : entry.shortTitle,
                  description: `Published package ${entry.npmPackage}@${entry.publishedVersion}`,
                })
                .then(() => {
                  setFocusStep("transport");
                })
                .catch((error: unknown) => {
                  const message =
                    error instanceof Error
                      ? error.message
                      : "Failed to create connector";
                  setCreateError(message);
                });
            }}
          />
        </SectionPanel>
      </div>
    </div>
  );
}

function SetupStepPanel(props: {
  readonly stepId: ConnectorSetupStepId;
  readonly entry: ConnectorCatalogEntry;
  readonly canWrite: boolean;
  readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
  readonly workspaceConnectorId?: string;
  readonly linkedVersions: readonly ConnectorVersionResource[];
  readonly versionsLoading: boolean;
  readonly installAllowed: boolean;
  readonly connectorName: string;
  readonly onConnectorNameChange: (value: string) => void;
  readonly createPending: boolean;
  readonly createError?: string;
  readonly onCreateConnector: () => void;
}) {
  const { entry } = props;
  const verifiedInstallCommand =
    buildVerifiedWorkerPackageInstallCommand(entry);

  switch (props.stepId) {
    case "requirements":
      return (
        <RequirementsStep
          entry={entry}
          verifiedInstallCommand={verifiedInstallCommand}
          installAllowed={props.installAllowed}
        />
      );
    case "workspace":
      return (
        <WorkspaceStep
          entry={entry}
          canWrite={props.canWrite}
          integrationStatus={props.integrationStatus}
          workspaceConnectorId={props.workspaceConnectorId}
          connectorName={props.connectorName}
          onConnectorNameChange={props.onConnectorNameChange}
          createPending={props.createPending}
          createError={props.createError}
          onCreateConnector={props.onCreateConnector}
        />
      );
    case "transport":
      return (
        <TransportStep
          entry={entry}
          canWrite={props.canWrite}
          workspaceConnectorId={props.workspaceConnectorId}
          linkedVersions={props.linkedVersions}
          versionsLoading={props.versionsLoading}
          verifiedInstallCommand={verifiedInstallCommand}
        />
      );
    case "prerequisites":
      return (
        <PrerequisitesStep
          entry={entry}
          linkedVersions={props.linkedVersions}
          installAllowed={props.installAllowed}
        />
      );
    case "discover":
      return (
        <DiscoverStep
          entry={entry}
          canWrite={props.canWrite}
          integrationStatus={props.integrationStatus}
          workspaceConnectorId={props.workspaceConnectorId}
          linkedVersions={props.linkedVersions}
        />
      );
  }
}

function RequirementsStep(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly verifiedInstallCommand: string;
  readonly installAllowed: boolean;
}) {
  const { entry } = props;
  return (
    <div className="connector-setup-step-stack">
      <p>
        Published package{" "}
        <code className="mono">
          {entry.npmPackage}@{entry.publishedVersion}
        </code>{" "}
        · connector-sdk {entry.sdkVersion}
      </p>
      <p className="muted">
        {describeNodeRuntimeRequirement(entry.sdkVersion)}
      </p>
      <ul className="example-detail-list">
        {describeAuthenticationGuidance(entry).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {entry.authentication.requiredCredentialEnv.map((name) => (
          <li key={name}>
            Env name (catalog): <code className="mono">{name}</code>
          </li>
        ))}
      </ul>
      <ConnectorSetupCopyableCommand
        label="Worker-side package install (operator-run; Console does not install packages)"
        command={props.verifiedInstallCommand}
      />
      {props.installAllowed ? (
        <p>
          <a
            href={entry.installGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Installation guide
          </a>
        </p>
      ) : null}
      <p className="muted">
        Audited catalog commit{" "}
        <code className="mono">
          {OSVA_CONNECTORS_AUDITED_SHA.slice(0, 12)}…
        </code>
      </p>
    </div>
  );
}

function WorkspaceStep(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly canWrite: boolean;
  readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
  readonly workspaceConnectorId?: string;
  readonly connectorName: string;
  readonly onConnectorNameChange: (value: string) => void;
  readonly createPending: boolean;
  readonly createError?: string;
  readonly onCreateConnector: () => void;
}) {
  if (!props.canWrite) {
    return (
      <p className="muted">{describeIntegrationsWriteRoleRequirement()}</p>
    );
  }

  if (
    props.integrationStatus !== "catalog-only" &&
    props.workspaceConnectorId
  ) {
    return (
      <div className="connector-setup-step-stack">
        <p role="status">Workspace connector linked by catalog key.</p>
        <p className="muted">
          Key <code className="mono">{props.entry.connectorKey}</code> (exact
          match only — custom keys are not associated with this catalog entry).
        </p>
        <LinkButton
          variant="primary"
          to={`/tools/connectors/${props.workspaceConnectorId}`}
        >
          Open workspace connector
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="connector-setup-step-stack">
      <p className="muted">
        A workspace connector with a different key is not linked here. Create an
        identity using the recommended catalog key below, or manage custom keys
        from <Link to="/tools/connectors">workspace connectors</Link>.
      </p>
      <dl className="meta-list">
        <div>
          <dt>Recommended key</dt>
          <dd>
            <code
              className="mono"
              data-testid="connector-setup-recommended-key"
            >
              {props.entry.connectorKey}
            </code>
          </dd>
        </div>
      </dl>
      <div className="field">
        <label htmlFor="setup-connector-name">Display name</label>
        <input
          id="setup-connector-name"
          className="ui-control"
          value={props.connectorName}
          onChange={(event) => props.onConnectorNameChange(event.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="primary"
        loading={props.createPending}
        disabled={props.connectorName.trim().length === 0}
        data-testid="connector-setup-create-identity"
        onClick={props.onCreateConnector}
      >
        Create workspace connector
      </Button>
      {props.createError !== undefined ? (
        <ErrorState
          title="Could not create connector"
          error={new Error(props.createError)}
          guidanceContext="generic"
        />
      ) : null}
      <p className="muted">
        Connector identities are never created automatically from catalog
        browsing.
      </p>
    </div>
  );
}

function TransportStep(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly canWrite: boolean;
  readonly workspaceConnectorId?: string;
  readonly linkedVersions: readonly ConnectorVersionResource[];
  readonly versionsLoading: boolean;
  readonly verifiedInstallCommand: string;
}) {
  if (props.versionsLoading && props.workspaceConnectorId !== undefined) {
    return <LoadingBlock label="Loading ConnectorVersions…" />;
  }

  const stdioVersions = props.linkedVersions.filter(
    (version) => version.transport === "STDIO",
  );
  const httpVersions = props.linkedVersions.filter(
    (version) => version.transport === "STREAMABLE_HTTP",
  );

  if (props.workspaceConnectorId === undefined) {
    return (
      <div className="connector-setup-step-stack">
        {props.entry.mcpTransport === "stdio" ? (
          <>
            <p role="status">{describeStdioOperatorBoundary()}</p>
            <p className="muted" data-testid="connector-setup-no-http-bridge">
              This published package is STDIO-only. Streamable HTTP setup in
              Console is not a supported alternative for this catalog entry.
            </p>
          </>
        ) : null}
        <p className="muted">Create a workspace connector identity first.</p>
      </div>
    );
  }

  return (
    <div className="connector-setup-step-stack">
      {props.entry.mcpTransport === "stdio" ? (
        <>
          <p role="status">{describeStdioOperatorBoundary()}</p>
          <ConnectorSetupCopyableCommand
            label="Install published package on worker hosts (operator-run)"
            command={props.verifiedInstallCommand}
          />
          <p className="muted">
            Provision a ConnectorVersion with the correct STDIO MCP settings on
            the control plane. Console displays existing STDIO versions but does
            not accept arbitrary commands.
          </p>
          {!streamableHttpOfferedForCatalogTransport(
            props.entry.mcpTransport,
          ) ? (
            <p className="muted" data-testid="connector-setup-no-http-bridge">
              This published package is STDIO-only. Streamable HTTP setup in
              Console is not a supported alternative for this catalog entry.
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted">
          Append a Streamable HTTP ConnectorVersion from the workspace connector
          detail page.
        </p>
      )}

      {stdioVersions.length > 0 ? (
        <section>
          <h3 className="section-title">STDIO ConnectorVersions</h3>
          <ul className="example-detail-list">
            {stdioVersions.map((version) => (
              <li key={version.id}>
                Version {version.version} ·{" "}
                {formatTransportLabel(version.transport)} · configured on
                workspace (provider not verified)
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.entry.mcpTransport === "streamable_http" && props.canWrite ? (
        <LinkButton
          variant="secondary"
          to={`/tools/connectors/${props.workspaceConnectorId}`}
        >
          Open HTTP version form
        </LinkButton>
      ) : null}

      {httpVersions.length > 0 ? (
        <section>
          <h3 className="section-title">Streamable HTTP ConnectorVersions</h3>
          <ul className="example-detail-list">
            {httpVersions.map((version) => (
              <li key={version.id}>{formatConnectorVersionOption(version)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <LinkButton
        variant="primary"
        to={`/tools/connectors/${props.workspaceConnectorId}`}
      >
        Open workspace connector
      </LinkButton>
    </div>
  );
}

function PrerequisitesStep(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly linkedVersions: readonly ConnectorVersionResource[];
  readonly installAllowed: boolean;
}) {
  return (
    <div className="connector-setup-step-stack">
      <p className="muted">
        Confirm operator gates, worker package availability, and provider
        credentials before discovery. Console cannot verify worker installation
        or secret resolution.
      </p>
      <ul className="example-detail-list">
        <li>{describeStdioOperatorBoundary()}</li>
        {props.entry.mcpTransport === "stdio" ? (
          <li>
            Worker must resolve environment names documented in the installation
            guide — listing them in catalog metadata is not proof they are set.
          </li>
        ) : null}
        <li>
          ConnectorVersion count in workspace:{" "}
          <strong>{props.linkedVersions.length}</strong> (configuration only,
          not live provider health).
        </li>
      </ul>
      {props.installAllowed ? (
        <p>
          <a
            href={props.entry.installGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Authoritative installation guide
          </a>
        </p>
      ) : null}
    </div>
  );
}

function DiscoverStep(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly canWrite: boolean;
  readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
  readonly workspaceConnectorId?: string;
  readonly linkedVersions: readonly ConnectorVersionResource[];
}) {
  if (props.workspaceConnectorId === undefined) {
    return (
      <p className="muted">
        Complete workspace connector and transport steps first.
      </p>
    );
  }

  if (props.linkedVersions.length === 0) {
    return (
      <p className="muted">
        Add a ConnectorVersion before MCP discovery. STDIO versions are
        operator-provisioned; HTTP versions use the workspace connector form.
      </p>
    );
  }

  return (
    <div className="connector-setup-step-stack">
      <p>
        Use the existing workspace connector page for MCP discovery and
        selective ToolVersion import. Import does not enable agent execution —
        bind ToolVersions on an AgentVersion separately.
      </p>
      {!props.canWrite ? (
        <p className="muted">{describeIntegrationsWriteRoleRequirement()}</p>
      ) : null}
      <ul className="example-detail-list">
        <li>Discovery lists remote MCP metadata only.</li>
        <li>Mutation-capable tools are not imported automatically.</li>
        <li>
          Successful discovery does not prove provider authentication or
          connectivity.
        </li>
      </ul>
      {props.integrationStatus === "tools-imported" ? (
        <p role="status" data-testid="connector-setup-tools-imported">
          MCP ToolVersions are imported for this connector key. Configure agent
          bindings in Agent Studio (B6.3C scope).
        </p>
      ) : null}
      <LinkButton
        variant="primary"
        to={connectorDiscoverHandoffPath(props.workspaceConnectorId)}
        data-testid="connector-setup-discover-handoff"
      >
        Open discover &amp; import
      </LinkButton>
    </div>
  );
}
