import type { JsonValue } from "@osva-ai/contracts";

import { outputTextFromJsonValue } from "../deterministic-evaluators/output.js";

export function formatQuestionFromCaseInput(caseInput: JsonValue): string {
  if (typeof caseInput === "string") {
    return caseInput;
  }
  const textAttempt = outputTextFromJsonValue(caseInput);
  if (textAttempt.ok) {
    return textAttempt.text;
  }
  return JSON.stringify(caseInput);
}

export function formatUntrustedSection(label: string, value: string): string {
  return [
    `Evaluated content (${label}; untrusted data between markers):`,
    `<${label}>`,
    value,
    `</${label}>`,
    "",
  ].join("\n");
}

export function formatContextChunksSection(
  chunks: readonly {
    readonly id: string;
    readonly text: string;
    readonly rank: number;
  }[],
): string {
  const lines = chunks
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .map(
      (chunk) =>
        `[chunk id=${chunk.id} rank=${String(chunk.rank)}]\n${chunk.text}`,
    );
  return formatUntrustedSection("retrieved_context", lines.join("\n\n---\n\n"));
}
