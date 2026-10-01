import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AjvImport from "ajv";
import type { ValidateFunction } from "ajv";

type AjvConstructor = new (options?: Record<string, unknown>) => {
  compile: (schema: object) => ValidateFunction;
  errorsText: (
    errors: ValidateFunction["errors"],
    options?: { separator?: string },
  ) => string;
};

const Ajv = AjvImport as unknown as AjvConstructor;

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function loadSchema(fileName: string): object {
  const fullPath = path.join(packageRoot, "contracts", fileName);
  return JSON.parse(readFileSync(fullPath, "utf8")) as object;
}

const ajv = new Ajv({ allErrors: true, strict: true });

export const validateWorkflowInput = ajv.compile(
  loadSchema("workflow-input.v1.schema.json"),
);
export const validateResearchOutput = ajv.compile(
  loadSchema("research-output.v1.schema.json"),
);
export const validateAnalysisOutput = ajv.compile(
  loadSchema("analysis-output.v1.schema.json"),
);
export const validateReportOutput = ajv.compile(
  loadSchema("report-output.v1.schema.json"),
);

export function assertValid(
  validator: ValidateFunction,
  value: unknown,
  label: string,
): void {
  const ok = validator(value);
  if (!ok) {
    throw new Error(
      `${label} failed validation: ${ajv.errorsText(validator.errors, { separator: "; " })}`,
    );
  }
}

export function assertInvalid(
  validator: ValidateFunction,
  value: unknown,
): boolean {
  return validator(value) === false;
}
