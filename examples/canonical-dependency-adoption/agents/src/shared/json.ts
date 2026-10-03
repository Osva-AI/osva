import { CanonicalAgentError } from "./errors.js";

export function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const fenceEnd = trimmed.lastIndexOf("```");
    if (fenceEnd > 0) {
      const inner = trimmed.slice(trimmed.indexOf("\n") + 1, fenceEnd).trim();
      if (inner.length > 0) {
        return inner;
      }
    }
  }
  return trimmed;
}

export function parseJsonObject(
  text: string,
  label: string,
): Record<string, unknown> {
  const payload = extractJsonPayload(text);
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new CanonicalAgentError(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CanonicalAgentError) {
      throw error;
    }
    throw new CanonicalAgentError(`${label} is not valid JSON.`);
  }
}

export function parseStringArray(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CanonicalAgentError(`${field} must be an array of strings.`);
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new CanonicalAgentError(`${field} must be an array of strings.`);
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      items.push(trimmed);
    }
  }
  return items;
}
