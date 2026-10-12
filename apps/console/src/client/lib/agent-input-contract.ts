import type { AgentVersionResource } from "../hooks/use-agents";
import type { ParsedWorkflowRunInput } from "./workflow-run-input";
import { extractAgentVersionInputSchema } from "./workflow-root-input-contract";

export type ResolvedAgentInputContract =
  | {
      readonly status: "available";
      readonly agentId: string;
      readonly agentVersionId: string;
      readonly schema: unknown;
    }
  | {
      readonly status: "schema_unavailable";
      readonly agentId: string;
      readonly agentVersionId: string;
      readonly reason: "schema_missing";
    }
  | {
      readonly status: "version_unavailable";
      readonly agentId: string;
      readonly agentVersionId: string;
    }
  | { readonly status: "loading" };

export function resolveAgentVersionInputContract(
  agentId: string,
  agentVersionId: string,
  version: AgentVersionResource | undefined,
  options: { readonly loading?: boolean } = {},
): ResolvedAgentInputContract {
  if (options.loading === true) {
    return { status: "loading" };
  }
  if (version === undefined) {
    return { status: "version_unavailable", agentId, agentVersionId };
  }

  const schema = extractAgentVersionInputSchema(version);
  if (schema === undefined) {
    return {
      status: "schema_unavailable",
      agentId,
      agentVersionId,
      reason: "schema_missing",
    };
  }

  return {
    status: "available",
    agentId,
    agentVersionId,
    schema,
  };
}

export function describeAgentRunInputSyntax(
  parsed: ParsedWorkflowRunInput,
  contract: ResolvedAgentInputContract,
): { readonly kind: "error" | "info"; readonly message: string } {
  if (!parsed.ok) {
    return { kind: "error", message: parsed.message };
  }

  switch (contract.status) {
    case "available":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. That does not mean this AgentVersion will accept the payload at execution time.",
      };
    case "schema_unavailable":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. This version has no input schema in the returned manifest.",
      };
    case "version_unavailable":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. The selected AgentVersion could not be loaded.",
      };
    case "loading":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. Loading the AgentVersion input contract…",
      };
  }
}

export function describeCreateRunFailure(status: number): string | undefined {
  switch (status) {
    case 400:
      return "The control plane rejected this request as invalid. Check AgentVersion identity and JSON input.";
    case 403:
      return "This API key cannot execute Runs (OPERATOR, EDITOR, or ADMIN required).";
    case 404:
      return "The Agent or AgentVersion was not found in the authenticated workspace.";
    case 409:
      return "The control plane reported a conflict. A Run with this idempotency key may already exist.";
    default:
      return undefined;
  }
}
