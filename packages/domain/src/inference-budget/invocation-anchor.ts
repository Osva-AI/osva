import { createHash } from "node:crypto";

import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  type InferenceInvocationAnchorContractV1,
  type InferenceInvocationKind,
  type WorkspaceId,
} from "@osva-ai/contracts";

import { canonicalJsonStringify } from "../json-equality.js";
import { assertInferenceBudgetWorkspaceScope } from "./workspace-scope.js";

const DOMAIN_SEPARATOR = "osva:inference-invocation-anchor" as const;

function invocationKindForScope(
  anchor: InferenceInvocationAnchorContractV1,
): InferenceInvocationKind {
  switch (anchor.material.scope) {
    case "AGENT_RUN":
      return anchor.invocationKind;
    case "EVALUATION_JUDGE":
      return "JUDGE";
    case "BATCH_INFERENCE":
      return "BATCH";
    default: {
      const exhaustive: never = anchor.material;
      throw new Error(`Unknown invocation scope: ${String(exhaustive)}`);
    }
  }
}

export function buildInferenceInvocationAnchorString(
  anchor: InferenceInvocationAnchorContractV1,
): string {
  assertInferenceBudgetWorkspaceScope({
    workspaceId: anchor.workspaceId,
    anchorWorkspaceId: anchor.workspaceId,
  });

  if (
    anchor.anchorFormatVersion !== INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION
  ) {
    throw new Error(
      `Unsupported invocation anchor format: ${anchor.anchorFormatVersion}`,
    );
  }

  const kind = invocationKindForScope(anchor);
  if (anchor.invocationKind !== kind && anchor.material.scope !== "AGENT_RUN") {
    throw new Error(
      `Invocation kind ${anchor.invocationKind} does not match scope ${anchor.material.scope}`,
    );
  }

  const material =
    anchor.anchorFormatVersion === "2" && anchor.material.scope === "AGENT_RUN"
      ? {
          scope: "AGENT_RUN" as const,
          runAttemptId: anchor.material.runAttemptId,
          bindingName: anchor.material.bindingName,
          modelInvocationOrdinal: anchor.material.modelInvocationOrdinal,
        }
      : anchor.material;

  const payload = {
    anchorFormatVersion: anchor.anchorFormatVersion,
    workspaceId: anchor.workspaceId,
    invocationKind: anchor.invocationKind,
    material,
  };

  const canonical = canonicalJsonStringify(payload);
  return createHash("sha256")
    .update(DOMAIN_SEPARATOR, "utf8")
    .update("\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

export function isDistinctLogicalInvocationAnchor(
  left: string,
  right: string,
): boolean {
  return left !== right;
}

export function assertInvocationAnchorWorkspace(
  workspaceId: WorkspaceId,
  invocationAnchor: string,
  anchor: InferenceInvocationAnchorContractV1,
): void {
  assertInferenceBudgetWorkspaceScope({
    workspaceId,
    anchorWorkspaceId: anchor.workspaceId,
  });
  const derived = buildInferenceInvocationAnchorString(anchor);
  if (derived !== invocationAnchor) {
    throw new Error("Invocation anchor does not match canonical derivation");
  }
}
