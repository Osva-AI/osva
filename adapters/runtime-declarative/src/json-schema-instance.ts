import Ajv2020Import from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

import type { JsonSchemaRecord } from "@osva-ai/contracts";

type AjvConstructor = new (options?: Record<string, unknown>) => {
  compile(schema: object): ValidateFunction;
};

const Ajv2020 = Ajv2020Import as unknown as AjvConstructor;

const ajv = new Ajv2020({ allErrors: true, strict: false });

const compiled = new WeakMap<JsonSchemaRecord, ValidateFunction>();

function compile(schema: JsonSchemaRecord): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached !== undefined) {
    return cached;
  }

  const validator = ajv.compile(schema as object);
  compiled.set(schema, validator);
  return validator;
}

export function validateJsonSchemaInstance(
  schema: JsonSchemaRecord,
  value: unknown,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const validator = compile(schema);
  if (validator(value)) {
    return { ok: true };
  }

  const message =
    validator.errors?.map((issue) => issue.message ?? "invalid").join("; ") ??
    "Value does not match schema.";

  return { ok: false, message };
}
