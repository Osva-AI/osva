/** Shared generation/refinement/repair guidance for RFC 6901 JSON Pointers (BRANCH / WAIT). */
export const BUILDER_JSON_POINTER_PROMPT_SECTION = `- BRANCH node \`selector\` and WAIT EVENT correlation \`pointer\` (INPUT_POINTER) must be RFC 6901 JSON Pointers evaluated against workflow run input data.
- Valid examples: /status, /analysis/result, /customer/tier, / (root via "/" with empty first token), /field~1name (token "field/name" — escape "/" as ~1)
- Invalid examples: $.status, analysis.result, {{status}}, /bad~2 (only ~0 and ~1 are valid after "~")
- Non-empty pointers MUST start with "/". Do not invent paths — use keys that match the intended workflow input shape or upstream agent output fields described in the user instruction.`;

export function buildBuilderProposalParseRepairHint(
  messages: readonly string[],
): string {
  const body = messages.map((m) => `  - ${m}`).join("\n");
  const extras: string[] = [];

  for (const message of messages) {
    const branchMatch = /^workflow\.nodes\[(\d+)\]:/.exec(message);
    if (message.includes("BRANCH selector must be a valid JSON Pointer")) {
      const where =
        branchMatch === null
          ? "BRANCH node"
          : `workflow.nodes[${branchMatch[1]}].selector`;
      extras.push(
        `  - Fix ${where}: use RFC 6901 JSON Pointer syntax (non-empty values start with "/"). Valid: /status, /analysis/result, /customer/tier. Invalid: $.status, dot paths (a.b), {{templates}}. Escape "~" as ~0 and "/" in token names as ~1; ~2 and bare ~ are rejected.`,
      );
    }

    if (
      message.includes("INPUT_POINTER pointer must be a valid JSON Pointer")
    ) {
      extras.push(
        "  - Fix WAIT correlation INPUT_POINTER.pointer with the same RFC 6901 rules as BRANCH selectors (leading slash, ~0/~1 escapes only).",
      );
    }
  }

  if (extras.length === 0) {
    return `- BuilderProposalV1 parse errors:\n${body}`;
  }

  return `- BuilderProposalV1 parse errors:\n${body}\n- JSON Pointer corrections:\n${extras.join("\n")}`;
}
