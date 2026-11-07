import type { SecurityAuditEvent } from "../security-audit-event.js";
import type { Agent } from "../agent.js";
import type { AgentVersion } from "../agent-version.js";
import type { Workflow } from "../workflow.js";
import type { WorkflowVersion } from "../workflow-version.js";
import type {
  BuilderPublicationId,
  BuilderPublicationReceiptV1,
} from "../builder/builder-publication-types.js";

export interface BuilderPublicationRecordV1 {
  readonly id: BuilderPublicationId;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly planDigest: string;
  readonly receipt: BuilderPublicationReceiptV1;
  readonly createdAt: Date;
}

export interface BuilderPublicationAtomicPersistInput {
  readonly publication: BuilderPublicationRecordV1;
  readonly newAgents: readonly Agent[];
  readonly newAgentVersions: readonly AgentVersion[];
  readonly workflow: Workflow;
  readonly workflowVersion: WorkflowVersion;
  readonly auditEvent: SecurityAuditEvent;
  /** Integration-test hooks (not used in production). */
  readonly testHooks?: {
    readonly afterNewAgentsPersisted?: () => Promise<void>;
    readonly afterNewAgentVersionsPersisted?: () => Promise<void>;
    readonly beforeWorkflowPersisted?: () => Promise<void>;
    readonly beforeReceiptPersisted?: () => Promise<void>;
    readonly beforeAuditPersisted?: () => Promise<void>;
  };
}

export interface BuilderPublicationRepository {
  findByWorkspaceAndIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<BuilderPublicationRecordV1 | null>;

  findByWorkspaceAndPublicationId(
    workspaceId: string,
    publicationId: BuilderPublicationId,
  ): Promise<BuilderPublicationRecordV1 | null>;

  publishAtomically(
    input: BuilderPublicationAtomicPersistInput,
  ): Promise<{ readonly replay: boolean }>;
}
