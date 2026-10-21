export interface GuidedRunInputField {
  readonly key: string;
  readonly label: string;
  readonly kind: "string" | "number" | "boolean";
  readonly required: boolean;
}

export function listGuidedRunInputFields(
  schema: unknown,
): readonly GuidedRunInputField[] | undefined {
  if (!isRecord(schema) || schema.type !== "object") {
    return undefined;
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = asStringArray(schema.required);
  const fields: GuidedRunInputField[] = [];

  for (const [key, propertySchema] of Object.entries(properties)) {
    const kind = guidedFieldKind(propertySchema);
    if (kind === undefined) {
      return undefined;
    }
    fields.push({
      key,
      label: key,
      kind,
      required: required.includes(key),
    });
  }

  if (fields.length === 0 || fields.length > 12) {
    return undefined;
  }

  return fields;
}

export function buildJsonFromGuidedValues(
  fields: readonly GuidedRunInputField[],
  values: Readonly<Record<string, string>>,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string } {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? "";
    if (field.required && raw.trim().length === 0) {
      return { ok: false, message: `${field.label} is required.` };
    }
    if (raw.trim().length === 0) {
      continue;
    }
    if (field.kind === "boolean") {
      if (raw !== "true" && raw !== "false") {
        return { ok: false, message: `${field.label} must be Yes or No.` };
      }
      output[field.key] = raw === "true";
      continue;
    }
    if (field.kind === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, message: `${field.label} must be a number.` };
      }
      output[field.key] = parsed;
      continue;
    }
    output[field.key] = raw;
  }
  return { ok: true, value: output };
}

function guidedFieldKind(
  schema: unknown,
): "string" | "number" | "boolean" | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }
  if (schema.type === "string") {
    return "string";
  }
  if (schema.type === "number" || schema.type === "integer") {
    return "number";
  }
  if (schema.type === "boolean") {
    return "boolean";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}
