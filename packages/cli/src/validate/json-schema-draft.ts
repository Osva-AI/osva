import Ajv2020Import from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

export const SUPPORTED_JSON_SCHEMA_DRAFT =
  "https://json-schema.org/draft/2020-12/schema" as const;

type AjvConstructor = new (options?: Record<string, unknown>) => {
  compile: (schema: object) => ValidateFunction;
  errorsText: (
    errors: ValidateFunction["errors"],
    options?: { separator?: string },
  ) => string;
};

const Ajv2020 = Ajv2020Import as unknown as AjvConstructor;

const ajv = new Ajv2020({ allErrors: true, strict: true });

export interface JsonSchemaDraftValidation {
  readonly ok: boolean;
  readonly warnMissingSchema?: boolean;
  readonly error?: string;
}

export function validateJsonSchemaDocument(
  schema: unknown,
  label: string,
): JsonSchemaDraftValidation {
  if (typeof schema !== "object" || schema === null) {
    return { ok: false, error: `${label} must be a JSON object.` };
  }

  const record = schema as Record<string, unknown>;
  const declared = record.$schema;
  let warnMissingSchema = false;
  if (declared === undefined) {
    warnMissingSchema = true;
  } else if (declared !== SUPPORTED_JSON_SCHEMA_DRAFT) {
    return {
      ok: false,
      error: `${label} $schema must be ${SUPPORTED_JSON_SCHEMA_DRAFT}.`,
    };
  }

  try {
    ajv.compile(schema as object);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON Schema document.";
    return { ok: false, error: `${label}: ${message}` };
  }

  return warnMissingSchema
    ? { ok: true, warnMissingSchema: true }
    : { ok: true };
}
