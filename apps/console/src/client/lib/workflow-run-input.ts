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
