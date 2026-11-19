import type {
  InferenceRoutingDecisionRecordV1,
  InferenceRoutingPolicyDefinitionV1,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyRecordV1,
  InferenceRoutingPolicyVersionId,
  InferenceRoutingPolicyVersionRecordV1,
  InferenceRoutingRuntimePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_ROUTING_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import { inferenceRoutingPolicyDefinitionSchema } from "@osva-ai/contracts/schemas";

import type { inferenceRoutingDecisions } from "../schema/inference-routing-decisions.js";
import type { inferenceRoutingPolicies } from "../schema/inference-routing-policies.js";
import type { inferenceRoutingPolicyVersions } from "../schema/inference-routing-policy-versions.js";
import type { workspaceInferenceRoutingActivation } from "../schema/workspace-inference-routing-activation.js";

type PolicyRow = typeof inferenceRoutingPolicies.$inferSelect;
type VersionRow = typeof inferenceRoutingPolicyVersions.$inferSelect;
type ActivationRow = typeof workspaceInferenceRoutingActivation.$inferSelect;
type DecisionRow = typeof inferenceRoutingDecisions.$inferSelect;

export function inferenceRoutingPolicyFromRow(
  row: PolicyRow,
): InferenceRoutingPolicyRecordV1 {
  return {
    id: row.id as InferenceRoutingPolicyId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    createdAt: row.createdAt.toISOString(),
  };
}

export function parseInferenceRoutingDefinition(
  value: unknown,
): InferenceRoutingPolicyDefinitionV1 {
  return inferenceRoutingPolicyDefinitionSchema.parse(value);
}

export function inferenceRoutingPolicyVersionFromRow(
  row: VersionRow,
): InferenceRoutingPolicyVersionRecordV1 {
  return {
    id: row.id as InferenceRoutingPolicyVersionId,
    policyId: row.policyId as InferenceRoutingPolicyId,
    workspaceId: row.workspaceId as WorkspaceId,
    version: row.version,
    definition: parseInferenceRoutingDefinition(row.definitionJson),
    createdAt: row.createdAt.toISOString(),
  };
}

export function inferenceRoutingRuntimePolicyFromActivation(input: {
  readonly activation: ActivationRow | undefined;
  readonly version: VersionRow | undefined;
}): InferenceRoutingRuntimePolicyV1 | null {
  if (input.activation === undefined) {
    return null;
  }

  if (!input.activation.enabled) {
    return {
      schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
      enabled: false,
      policyRevisionId: input.activation.updatedAt.toISOString(),
    };
  }

  if (input.version === undefined) {
    return {
      schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
      enabled: false,
      policyRevisionId: input.activation.updatedAt.toISOString(),
    };
  }

  return {
    schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
    enabled: true,
    policyVersionId: input.version.id as InferenceRoutingPolicyVersionId,
    definition: parseInferenceRoutingDefinition(input.version.definitionJson),
    policyRevisionId: input.activation.updatedAt.toISOString(),
  };
}

export function inferenceRoutingDecisionFromRow(
  row: DecisionRow,
): InferenceRoutingDecisionRecordV1 {
  return row.decisionJson as InferenceRoutingDecisionRecordV1;
}
