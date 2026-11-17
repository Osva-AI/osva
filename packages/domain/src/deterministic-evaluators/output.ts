import {
  EVALUATOR_RUN_OUTPUT_TEXT_MAX_LENGTH,
  isCanonicalJsonValue,
  type JsonValue,
} from "@osva-ai/contracts";

export function outputTextFromJsonValue(
  output: JsonValue,
): { readonly ok: true; readonly text: string } | { readonly ok: false } {
  if (typeof output !== "string") {
    return { ok: false };
  }
  if (output.length > EVALUATOR_RUN_OUTPUT_TEXT_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, text: output };
}

export function assertCanonicalRunOutput(output: unknown): output is JsonValue {
  return isCanonicalJsonValue(output);
}

export function parseJsonDocumentFromText(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return isCanonicalJsonValue(parsed);
  } catch {
    return false;
  }
}
