export interface PublishedEvaluationCaseSource {
  readonly key: string;
  readonly name?: string;
  readonly input: unknown;
  readonly expected?: unknown;
  readonly evaluator: { readonly type: string; readonly expected?: unknown };
}

export interface PublishedEvaluationSuiteVersionSource {
  readonly id: string;
  readonly cases: readonly PublishedEvaluationCaseSource[];
}

export interface EvaluationSuiteCaseDraft {
  readonly draftCaseId: string;
  readonly key: string;
  readonly name: string;
  readonly inputJson: string;
  readonly expectedOutputJson: string;
}

export interface EvaluationSuiteVersionDraft {
  readonly draftId: string;
  readonly workspaceId: string;
  readonly evaluationSuiteId: string;
  readonly sourceVersionId?: string;
  readonly cases: readonly EvaluationSuiteCaseDraft[];
  readonly dirty: boolean;
}

export function createDraftCaseId(): string {
  return crypto.randomUUID();
}

export function createEmptyCaseDraft(): EvaluationSuiteCaseDraft {
  return {
    draftCaseId: createDraftCaseId(),
    key: "",
    name: "",
    inputJson: "{\n  \n}",
    expectedOutputJson: "{\n  \n}",
  };
}

export function createEmptyVersionDraft(input: {
  readonly workspaceId: string;
  readonly evaluationSuiteId: string;
}): EvaluationSuiteVersionDraft {
  return {
    draftId: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    evaluationSuiteId: input.evaluationSuiteId,
    cases: [createEmptyCaseDraft()],
    dirty: false,
  };
}

export function createDraftFromPublishedVersion(input: {
  readonly workspaceId: string;
  readonly evaluationSuiteId: string;
  readonly version: PublishedEvaluationSuiteVersionSource;
}): EvaluationSuiteVersionDraft {
  return {
    draftId: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    evaluationSuiteId: input.evaluationSuiteId,
    sourceVersionId: input.version.id,
    dirty: false,
    cases: input.version.cases.map((evaluationCase) => ({
      draftCaseId: createDraftCaseId(),
      key: evaluationCase.key,
      name: evaluationCase.name ?? "",
      inputJson: JSON.stringify(evaluationCase.input, null, 2),
      expectedOutputJson: JSON.stringify(
        evaluationCase.evaluator.type === "JSON_EXACT_MATCH"
          ? evaluationCase.evaluator.expected
          : (evaluationCase.expected ?? evaluationCase.input),
        null,
        2,
      ),
    })),
  };
}

export function duplicateCaseDraft(
  draft: EvaluationSuiteCaseDraft,
): EvaluationSuiteCaseDraft {
  return {
    ...draft,
    draftCaseId: createDraftCaseId(),
    key: draft.key.length > 0 ? `${draft.key}-copy` : "",
  };
}

export function markDraftDirty(
  draft: EvaluationSuiteVersionDraft,
): EvaluationSuiteVersionDraft {
  return draft.dirty ? draft : { ...draft, dirty: true };
}
