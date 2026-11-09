import type { BuilderProposalV1 } from "@osva/domain/builder";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
} from "@osva/domain/builder";
import type { WorkspaceBuilderCapabilityCatalogV1 } from "@osva/domain/builder";

export type M20_6ScenarioStatus =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "ERROR"
  | "NOT_RUN"
  | "UNSUPPORTED_PRECONDITION";

export interface M20_6ScenarioResult {
  readonly id: string;
  readonly status: M20_6ScenarioStatus;
  readonly structuralScore: 0 | 1 | 2;
  readonly intentScore: 0 | 1 | 2;
  readonly refinementScore?: 0 | 1 | 2;
  readonly publicationScore?: 0 | 1 | 2;
  readonly latencyMs?: number;
  readonly providerAttempts?: number;
  readonly usageMeasured?: boolean;
  readonly inputUnits?: number;
  readonly outputUnits?: number;
  readonly errorCode?: string;
  readonly httpStatus?: number;
  readonly builderErrorCode?: string;
  readonly builderMessage?: string;
  readonly builderDetailMessages?: readonly string[];
  readonly providerDiagnostic?: import("./m20-7-live-eval.js").M20_7SanitizedBuilderProviderDiagnostic;
  readonly providerDiagnosticUnavailableReason?: string;
}

export function scoreProposalTopology(
  proposal: BuilderProposalV1,
  requireNodeTypes: readonly string[] = [],
): 0 | 1 | 2 {
  const types = new Set(proposal.workflow.nodes.map((n) => n.type));
  const missing = requireNodeTypes.filter((t) => !types.has(t as never));
  if (missing.length === 0) {
    return 2;
  }
  if (missing.length < requireNodeTypes.length) {
    return 1;
  }
  return 0;
}

export function assertCompilesForPublication(
  proposal: BuilderProposalV1,
  catalog: WorkspaceBuilderCapabilityCatalogV1,
): { ok: boolean; issues: readonly string[] } {
  const index = buildBuilderCatalogIndex(catalog);
  const compiled = compileBuilderProposalPrePublication(proposal, index);
  const blocking = compiled.issues.filter((i) => i.severity === "error");
  return {
    ok: blocking.length === 0,
    issues: blocking.map((i) => i.code),
  };
}
