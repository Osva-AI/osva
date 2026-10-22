import type { EvaluationCaseDefinitionV1, JsonValue } from "@osva-ai/contracts";
import { createEvaluationSuiteVersionRequestSchema } from "@osva-ai/contracts/schemas";

import type {
  EvaluationSuiteCaseDraft,
  EvaluationSuiteVersionDraft,
} from "./evaluation-suite-builder-draft";

export interface EvaluationSuiteFieldError {
  readonly draftCaseId?: string;
  readonly field: "key" | "inputJson" | "expectedOutputJson" | "cases";
  readonly message: string;
}

export interface EvaluationSuitePublishValidation {
  readonly ok: true;
  readonly cases: readonly EvaluationCaseDefinitionV1[];
}

export interface EvaluationSuitePublishValidationFailure {
  readonly ok: false;
  readonly fieldErrors: readonly EvaluationSuiteFieldError[];
}

export type EvaluationSuitePublishValidationResult =
  EvaluationSuitePublishValidation | EvaluationSuitePublishValidationFailure;

export function findDuplicateCaseKeys(
  cases: readonly Pick<EvaluationSuiteCaseDraft, "draftCaseId" | "key">[],
): readonly EvaluationSuiteFieldError[] {
  const seen = new Map<string, string>();
  const errors: EvaluationSuiteFieldError[] = [];
  for (const evaluationCase of cases) {
    const normalized = evaluationCase.key.trim();
    if (normalized.length === 0) {
      continue;
    }
    const prior = seen.get(normalized);
    if (prior !== undefined) {
      errors.push({
        draftCaseId: evaluationCase.draftCaseId,
        field: "key",
        message: `Duplicate case key "${normalized}".`,
      });
      if (!errors.some((error) => error.draftCaseId === prior)) {
        errors.push({
          draftCaseId: prior,
          field: "key",
          message: `Duplicate case key "${normalized}".`,
        });
      }
    } else {
      seen.set(normalized, evaluationCase.draftCaseId);
    }
  }
  return errors;
}

function parseJsonField(
  raw: string,
  field: "inputJson" | "expectedOutputJson",
  draftCaseId: string,
):
  { readonly ok: true; readonly value: JsonValue } | EvaluationSuiteFieldError {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      draftCaseId,
      field,
      message:
        field === "inputJson"
          ? "Test input JSON is required."
          : "Expected output JSON is required.",
    };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonValue };
  } catch {
    return {
      draftCaseId,
      field,
      message: "Invalid JSON syntax.",
    };
  }
}

export function validateDraftForPublish(
  draft: EvaluationSuiteVersionDraft,
): EvaluationSuitePublishValidationResult {
  const fieldErrors: EvaluationSuiteFieldError[] = [];

  if (draft.cases.length === 0) {
    fieldErrors.push({
      field: "cases",
      message: "Add at least one test case before publishing.",
    });
    return { ok: false, fieldErrors };
  }

  fieldErrors.push(...findDuplicateCaseKeys(draft.cases));

  const caseDefinitions: EvaluationCaseDefinitionV1[] = [];

  for (const evaluationCase of draft.cases) {
    if (evaluationCase.key.trim().length === 0) {
      fieldErrors.push({
        draftCaseId: evaluationCase.draftCaseId,
        field: "key",
        message: "Case key is required.",
      });
    }

    const inputParsed = parseJsonField(
      evaluationCase.inputJson,
      "inputJson",
      evaluationCase.draftCaseId,
    );
    if ("message" in inputParsed) {
      fieldErrors.push(inputParsed);
    }

    const expectedParsed = parseJsonField(
      evaluationCase.expectedOutputJson,
      "expectedOutputJson",
      evaluationCase.draftCaseId,
    );
    if ("message" in expectedParsed) {
      fieldErrors.push(expectedParsed);
    }

    if (
      !("message" in inputParsed) &&
      !("message" in expectedParsed) &&
      evaluationCase.key.trim().length > 0
    ) {
      caseDefinitions.push({
        key: evaluationCase.key.trim(),
        ...(evaluationCase.name.trim().length > 0
          ? { name: evaluationCase.name.trim() }
          : {}),
        input: inputParsed.value,
        expected: expectedParsed.value,
        evaluator: {
          type: "JSON_EXACT_MATCH",
          expected: expectedParsed.value,
        },
      });
    }
  }

  if (fieldErrors.length > 0) {
    return { ok: false, fieldErrors };
  }

  const schemaResult = createEvaluationSuiteVersionRequestSchema.safeParse({
    cases: caseDefinitions,
  });
  if (!schemaResult.success) {
    return {
      ok: false,
      fieldErrors: [
        {
          field: "cases",
          message: "Cases do not match the evaluation suite contract.",
        },
      ],
    };
  }

  return { ok: true, cases: schemaResult.data.cases };
}

export function fieldErrorsForCase(
  fieldErrors: readonly EvaluationSuiteFieldError[],
  draftCaseId: string,
  field: EvaluationSuiteFieldError["field"],
): readonly string[] {
  return fieldErrors
    .filter(
      (error) =>
        error.draftCaseId === draftCaseId &&
        (error.field === field || error.field === "cases"),
    )
    .map((error) => error.message);
}
