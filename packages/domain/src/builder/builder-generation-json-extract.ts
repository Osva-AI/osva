/**
 * Extract exactly one top-level JSON object from model text. Rejects arrays, multiple roots,
 * or trailing non-whitespace after the closing brace.
 */
export function extractSingleJsonObject(
  text: string,
): { ok: true; json: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }

  /** Reject leading prose or markdown before the JSON object (untrusted output). */
  if (trimmed[0] !== "{") {
    return { ok: false, reason: "leading_non_json" };
  }

  const first = trimmed.indexOf("{");
  if (first < 0) {
    return { ok: false, reason: "no_object" };
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const json = trimmed.slice(first, i + 1);
        const rest = trimmed.slice(i + 1).trim();
        if (rest.length > 0) {
          return { ok: false, reason: "trailing_content" };
        }

        return { ok: true, json };
      }
    }
  }

  return { ok: false, reason: "unclosed_or_invalid" };
}
