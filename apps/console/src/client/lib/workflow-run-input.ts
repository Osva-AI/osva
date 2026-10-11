import {
  isEmptyObjectJsonSchema,
  type ResolvedRootInputContract,
} from "./workflow-root-input-contract";

export type ParsedWorkflowRunInput =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

export function parseWorkflowRunInputJson(
  text: string,
): ParsedWorkflowRunInput {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      message: "Run input is required. Use {} for empty input.",
    };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof SyntaxError
          ? error.message
          : "Run input must be valid JSON.",
    };
  }
}

export function describeWorkflowRunInputSyntax(
  parsed: ParsedWorkflowRunInput,
  contract: ResolvedRootInputContract,
): { readonly kind: "error" | "info"; readonly message: string } {
  if (!parsed.ok) {
    return { kind: "error", message: parsed.message };
  }

  switch (contract.status) {
    case "available":
      if (isEmptyObjectJsonSchema(contract.schema)) {
        return {
          kind: "info",
          message:
            "JSON syntax is valid. This workflow accepts empty-object input.",
        };
      }
      return {
        kind: "info",
        message:
          "JSON syntax is valid. That does not mean the first agent will accept this payload.",
      };
    case "schema_unavailable":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. The first agent's input schema is unavailable.",
      };
    case "catalog_unavailable":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. Agent version metadata could not be loaded.",
      };
    case "non_agent_root":
      return {
        kind: "info",
        message: `JSON syntax is valid. The root node is ${contract.nodeType}, so no agent input contract is shown.`,
      };
    case "multiple_roots":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. This definition has multiple root nodes; V3 requires a single entry node.",
      };
    case "missing_binding":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. The root AGENT node has no bound AgentVersion.",
      };
    case "loading":
      return {
        kind: "info",
        message:
          "JSON syntax is valid. Loading the first agent's input contract…",
      };
    default:
      return {
        kind: "info",
        message:
          "JSON syntax is valid. Valid JSON is not necessarily executable input.",
      };
  }
}
