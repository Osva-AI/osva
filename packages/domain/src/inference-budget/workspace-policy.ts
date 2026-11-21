import type {
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetRuntimePolicyV1,
} from "@osva-ai/contracts";
import { createDefaultInferenceBudgetRuntimePolicy } from "@osva-ai/contracts";

export function mergeTrustedInferenceBudgetRuntimePolicy(
  policy: InferenceBudgetRuntimePolicyV1 | null | undefined,
): InferenceBudgetRuntimePolicyV1 {
  return policy ?? createDefaultInferenceBudgetRuntimePolicy();
}

export function resolveInferenceBudgetAdmitCeilingUsdMicros(input: {
  readonly policy: InferenceBudgetPolicyDefinitionV1;
  readonly admitCeilingUsdMicros: number | null;
}): number | null {
  if (input.admitCeilingUsdMicros !== null) {
    return input.admitCeilingUsdMicros;
  }
  if (input.policy.unknownAdmitCostBehavior === "USE_POLICY_FLOOR_USD_MICROS") {
    return input.policy.unknownAdmitCostFloorUsdMicros ?? null;
  }
  return null;
}
