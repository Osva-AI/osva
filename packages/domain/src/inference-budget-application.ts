import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetRuntimePolicyV1,
  SecurityAuditEventId,
  UserId,
  WorkspaceId,
  WorkspaceInferenceBudgetActivationV1,
} from "@osva-ai/contracts";
import {
  AUTHORIZATION_ACTIONS,
  computeInferenceBudgetAvailableUsdMicros,
  createDefaultInferenceBudgetRuntimePolicy,
  createDefaultWorkspaceInferenceBudgetActivation,
} from "@osva-ai/contracts";
import { isHumanSessionRequestPrincipal } from "@osva-ai/contracts";

import { buildInferenceBudgetActivationChangedAuditEvent } from "./control-plane-audit-events.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import {
  InferenceBudgetActivationMutationsDisabledError,
  InferenceBudgetPolicyNotFoundError,
  InferenceBudgetPolicyVersionNotFoundError,
} from "./errors.js";
import {
  parseInferenceBudgetPeriodKey,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "./inference-budget/period.js";
import type { InferenceBudgetPolicyRepository } from "./ports/inference-budget-policy-repository.js";

const BUDGET_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.inferenceBudgetPolicy,
} as const;

export interface InferenceBudgetApplicationClock {
  now(): Date;
}

export interface InferenceBudgetApplicationIds {
  createPolicyId(): InferenceBudgetPolicyId;
  createPolicyVersionId(): InferenceBudgetPolicyVersionId;
}

export interface InferenceBudgetSecurityAuditIds {
  createId(): SecurityAuditEventId;
}

export interface InferenceBudgetPeriodLedgerReadPort {
  loadPeriodLedger(
    workspaceId: WorkspaceId,
    periodKey: InferenceBudgetPeriodKeyV1,
  ): Promise<InferenceBudgetPeriodLedgerV1 | null>;
}

export interface InferenceBudgetApplicationDependencies {
  readonly policies: InferenceBudgetPolicyRepository;
  readonly periodLedger: InferenceBudgetPeriodLedgerReadPort;
  readonly clock: InferenceBudgetApplicationClock;
  readonly ids: InferenceBudgetApplicationIds;
  /** Server-side gate; must not disable worker enforcement of already-active policy. */
  readonly activationMutationsEnabled: boolean;
  readonly securityAuditIds: InferenceBudgetSecurityAuditIds;
}

function resolveActor(scope: ControlPlaneScope): {
  readonly actorUserId: UserId | undefined;
  readonly actorSubjectId: string;
} {
  const principal = scope.principal;
  if (isHumanSessionRequestPrincipal(principal)) {
    return {
      actorUserId: principal.userId,
      actorSubjectId: principal.userId,
    };
  }
  return {
    actorUserId: undefined,
    actorSubjectId: principal.subjectId,
  };
}

async function loadWorkspaceInferenceBudgetStatus(
  deps: InferenceBudgetApplicationDependencies,
  workspaceId: WorkspaceId,
): Promise<WorkspaceInferenceBudgetConfigurationV1> {
  const now = deps.clock.now().toISOString();
  const activation =
    (await deps.policies.findWorkspaceActivation(workspaceId)) ??
    createDefaultWorkspaceInferenceBudgetActivation(workspaceId, now);
  const runtime =
    (await deps.policies.findRuntimePolicyByWorkspaceId(workspaceId)) ??
    createDefaultInferenceBudgetRuntimePolicy();
  return {
    activation,
    runtimePolicy: runtime,
    activationMutationsPermitted: deps.activationMutationsEnabled,
  };
}

export interface CreateInferenceBudgetPolicyCommand {
  readonly key: string;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
}

export class CreateInferenceBudgetPolicy {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateInferenceBudgetPolicyCommand,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const now = this.deps.clock.now();
    const policyId = this.deps.ids.createPolicyId();
    const versionId = this.deps.ids.createPolicyVersionId();

    await this.deps.policies.savePolicy({
      id: policyId,
      workspaceId,
      key: command.key,
      createdAt: now,
    });
    await this.deps.policies.savePolicyVersion({
      id: versionId,
      policyId,
      workspaceId,
      version: 1,
      definition: command.definition,
      createdAt: now,
    });

    return {
      policy: await this.deps.policies.findPolicyById(workspaceId, policyId),
      version: await this.deps.policies.findPolicyVersionById(
        workspaceId,
        versionId,
      ),
    };
  }
}

export interface AppendInferenceBudgetPolicyVersionCommand {
  readonly policyId: InferenceBudgetPolicyId;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
}

export class AppendInferenceBudgetPolicyVersion {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendInferenceBudgetPolicyVersionCommand,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const policy = await this.deps.policies.findPolicyById(
      workspaceId,
      command.policyId,
    );
    if (policy === null) {
      throw new InferenceBudgetPolicyNotFoundError(command.policyId);
    }

    const versionId = this.deps.ids.createPolicyVersionId();
    const now = this.deps.clock.now();

    return this.deps.policies.appendPolicyVersion({
      id: versionId,
      policyId: command.policyId,
      workspaceId,
      definition: command.definition,
      createdAt: now,
    });
  }
}

export class ListInferenceBudgetPolicies {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(scope: ControlPlaneScope) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    return this.deps.policies.listPoliciesByWorkspace(
      controlPlaneWorkspaceId(scope),
    );
  }
}

export class GetInferenceBudgetPolicy {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(scope: ControlPlaneScope, policyId: InferenceBudgetPolicyId) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const policy = await this.deps.policies.findPolicyById(
      controlPlaneWorkspaceId(scope),
      policyId,
    );
    if (policy === null) {
      throw new InferenceBudgetPolicyNotFoundError(policyId);
    }
    return policy;
  }
}

export class ListInferenceBudgetPolicyVersions {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(scope: ControlPlaneScope, policyId: InferenceBudgetPolicyId) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const policy = await this.deps.policies.findPolicyById(
      workspaceId,
      policyId,
    );
    if (policy === null) {
      throw new InferenceBudgetPolicyNotFoundError(policyId);
    }
    return this.deps.policies.listPolicyVersions(workspaceId, policyId);
  }
}

export class GetInferenceBudgetPolicyVersion {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    policyVersionId: InferenceBudgetPolicyVersionId,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const version = await this.deps.policies.findPolicyVersionById(
      controlPlaneWorkspaceId(scope),
      policyVersionId,
    );
    if (version === null) {
      throw new InferenceBudgetPolicyVersionNotFoundError(policyVersionId);
    }
    return version;
  }
}

export interface WorkspaceInferenceBudgetConfigurationV1 {
  readonly activation: WorkspaceInferenceBudgetActivationV1;
  readonly runtimePolicy: InferenceBudgetRuntimePolicyV1;
  readonly activationMutationsPermitted: boolean;
}

export class GetWorkspaceInferenceBudgetConfiguration {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
  ): Promise<WorkspaceInferenceBudgetConfigurationV1> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
  }
}

export interface ActivateWorkspaceInferenceBudgetCommand {
  readonly policyVersionId: InferenceBudgetPolicyVersionId;
  readonly correlationId: string;
}

export class ActivateWorkspaceInferenceBudget {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: ActivateWorkspaceInferenceBudgetCommand,
  ): Promise<WorkspaceInferenceBudgetConfigurationV1> {
    if (!this.deps.activationMutationsEnabled) {
      throw new InferenceBudgetActivationMutationsDisabledError();
    }
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const version = await this.deps.policies.findPolicyVersionById(
      workspaceId,
      command.policyVersionId,
    );
    if (version === null) {
      throw new InferenceBudgetPolicyVersionNotFoundError(
        command.policyVersionId,
      );
    }

    const now = this.deps.clock.now();
    const actor = resolveActor(scope);
    const current =
      await this.deps.policies.findWorkspaceActivation(workspaceId);
    const previousEnabled = current?.enabled ?? false;
    const previousPolicyVersionId = current?.activePolicyVersionId;

    if (
      previousEnabled === true &&
      previousPolicyVersionId === command.policyVersionId
    ) {
      return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
    }

    const auditEvent = buildInferenceBudgetActivationChangedAuditEvent({
      id: this.deps.securityAuditIds.createId(),
      occurredAt: now,
      workspaceId,
      actorUserId: actor.actorUserId,
      actorSubjectId: actor.actorSubjectId,
      correlationId: command.correlationId,
      action: "ACTIVATE",
      previousEnabled,
      previousPolicyVersionId,
      newEnabled: true,
      newPolicyVersionId: command.policyVersionId,
    });

    await this.deps.policies.upsertWorkspaceActivationWithAudit({
      workspaceId,
      enabled: true,
      activePolicyVersionId: command.policyVersionId,
      updatedAt: now,
      auditEvent,
    });

    return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
  }
}

export interface DisableWorkspaceInferenceBudgetCommand {
  readonly correlationId: string;
}

export class DisableWorkspaceInferenceBudget {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: DisableWorkspaceInferenceBudgetCommand,
  ): Promise<WorkspaceInferenceBudgetConfigurationV1> {
    if (!this.deps.activationMutationsEnabled) {
      throw new InferenceBudgetActivationMutationsDisabledError();
    }
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const now = this.deps.clock.now();
    const actor = resolveActor(scope);
    const current =
      await this.deps.policies.findWorkspaceActivation(workspaceId);
    const previousEnabled = current?.enabled ?? false;
    const previousPolicyVersionId = current?.activePolicyVersionId;

    if (previousEnabled === false) {
      return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
    }

    const auditEvent = buildInferenceBudgetActivationChangedAuditEvent({
      id: this.deps.securityAuditIds.createId(),
      occurredAt: now,
      workspaceId,
      actorUserId: actor.actorUserId,
      actorSubjectId: actor.actorSubjectId,
      correlationId: command.correlationId,
      action: "DISABLE",
      previousEnabled,
      previousPolicyVersionId,
      newEnabled: false,
    });

    await this.deps.policies.upsertWorkspaceActivationWithAudit({
      workspaceId,
      enabled: false,
      activePolicyVersionId: undefined,
      updatedAt: now,
      auditEvent,
    });

    return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
  }
}

export class GetWorkspaceInferenceBudgetActivationStatus {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
  ): Promise<WorkspaceInferenceBudgetConfigurationV1> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    return loadWorkspaceInferenceBudgetStatus(this.deps, workspaceId);
  }
}

export interface InferenceBudgetPeriodUsageV1 {
  readonly period: InferenceBudgetPeriodLedgerV1["period"];
  readonly ledger: InferenceBudgetPeriodLedgerV1 | null;
  readonly availableReservationCapacityUsdMicros: number | null;
  /** Liability buckets are OSVA estimates — not guaranteed provider invoices. */
  readonly liabilityAccountingKind: "ESTIMATED_RESERVATION_LIABILITY";
}

export class GetInferenceBudgetPeriodUsage {
  constructor(private readonly deps: InferenceBudgetApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    periodKey?: InferenceBudgetPeriodKeyV1,
  ): Promise<InferenceBudgetPeriodUsageV1> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BUDGET_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const resolvedPeriod =
      periodKey === undefined
        ? resolveInferenceBudgetUtcPeriodIdentity(this.deps.clock.now())
        : (() => {
            const { year, monthIndex } = parseInferenceBudgetPeriodKey(
              periodKey as string,
            );
            const periodStartMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0);
            const periodEndExclusiveMs = Date.UTC(
              year,
              monthIndex + 1,
              1,
              0,
              0,
              0,
              0,
            );
            return {
              periodKind: "CALENDAR_MONTH_UTC" as const,
              periodKey,
              periodStartUtc: new Date(periodStartMs).toISOString(),
              periodEndExclusiveUtc: new Date(
                periodEndExclusiveMs,
              ).toISOString(),
            };
          })();

    const ledger = await this.deps.periodLedger.loadPeriodLedger(
      workspaceId,
      resolvedPeriod.periodKey,
    );

    return {
      period: resolvedPeriod,
      ledger,
      availableReservationCapacityUsdMicros:
        ledger === null
          ? null
          : computeInferenceBudgetAvailableUsdMicros(ledger),
      liabilityAccountingKind: "ESTIMATED_RESERVATION_LIABILITY",
    };
  }
}

export interface InferenceBudgetApplication {
  readonly createInferenceBudgetPolicy: CreateInferenceBudgetPolicy;
  readonly appendInferenceBudgetPolicyVersion: AppendInferenceBudgetPolicyVersion;
  readonly listInferenceBudgetPolicies: ListInferenceBudgetPolicies;
  readonly getInferenceBudgetPolicy: GetInferenceBudgetPolicy;
  readonly listInferenceBudgetPolicyVersions: ListInferenceBudgetPolicyVersions;
  readonly getInferenceBudgetPolicyVersion: GetInferenceBudgetPolicyVersion;
  readonly getWorkspaceInferenceBudgetConfiguration: GetWorkspaceInferenceBudgetConfiguration;
  readonly getWorkspaceInferenceBudgetActivationStatus: GetWorkspaceInferenceBudgetActivationStatus;
  readonly activateWorkspaceInferenceBudget: ActivateWorkspaceInferenceBudget;
  readonly disableWorkspaceInferenceBudget: DisableWorkspaceInferenceBudget;
  readonly getInferenceBudgetPeriodUsage: GetInferenceBudgetPeriodUsage;
}

export function createInferenceBudgetApplication(
  deps: InferenceBudgetApplicationDependencies,
): InferenceBudgetApplication {
  return {
    createInferenceBudgetPolicy: new CreateInferenceBudgetPolicy(deps),
    appendInferenceBudgetPolicyVersion: new AppendInferenceBudgetPolicyVersion(
      deps,
    ),
    listInferenceBudgetPolicies: new ListInferenceBudgetPolicies(deps),
    getInferenceBudgetPolicy: new GetInferenceBudgetPolicy(deps),
    listInferenceBudgetPolicyVersions: new ListInferenceBudgetPolicyVersions(
      deps,
    ),
    getInferenceBudgetPolicyVersion: new GetInferenceBudgetPolicyVersion(deps),
    getWorkspaceInferenceBudgetConfiguration:
      new GetWorkspaceInferenceBudgetConfiguration(deps),
    getWorkspaceInferenceBudgetActivationStatus:
      new GetWorkspaceInferenceBudgetActivationStatus(deps),
    activateWorkspaceInferenceBudget: new ActivateWorkspaceInferenceBudget(
      deps,
    ),
    disableWorkspaceInferenceBudget: new DisableWorkspaceInferenceBudget(deps),
    getInferenceBudgetPeriodUsage: new GetInferenceBudgetPeriodUsage(deps),
  };
}
