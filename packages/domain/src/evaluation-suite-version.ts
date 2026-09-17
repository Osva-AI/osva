import type {
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";

import type { EvaluationCase } from "./evaluation-case.js";
import { DomainInvariantError } from "./errors.js";
import { copyInstant, requirePositiveInteger } from "./internals.js";

export interface EvaluationSuiteVersionProps {
  readonly id: EvaluationSuiteVersionId;
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly cases: readonly EvaluationCase[];
  readonly createdAt: Date;
}

export class EvaluationSuiteVersion {
  readonly id: EvaluationSuiteVersionId;
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly cases: readonly EvaluationCase[];
  readonly createdAt: Date;

  private constructor(props: EvaluationSuiteVersionProps) {
    this.id = props.id;
    this.evaluationSuiteId = props.evaluationSuiteId;
    this.workspaceId = props.workspaceId;
    this.version = props.version;
    this.cases = props.cases;
    this.createdAt = props.createdAt;
  }

  static create(props: EvaluationSuiteVersionProps): EvaluationSuiteVersion {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationSuiteVersion.id is required.");
    }

    if (!props.evaluationSuiteId) {
      throw new DomainInvariantError(
        "EvaluationSuiteVersion.evaluationSuiteId is required.",
      );
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "EvaluationSuiteVersion.workspaceId is required.",
      );
    }

    if (props.cases.length === 0) {
      throw new DomainInvariantError(
        "EvaluationSuiteVersion.cases must contain at least one case.",
      );
    }

    return Object.freeze(
      new EvaluationSuiteVersion({
        id: props.id,
        evaluationSuiteId: props.evaluationSuiteId,
        workspaceId: props.workspaceId,
        version: requirePositiveInteger(
          props.version,
          "EvaluationSuiteVersion.version",
        ),
        cases: Object.freeze([...props.cases]),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }

  static rehydrate(
    props: Omit<EvaluationSuiteVersionProps, "cases"> & {
      readonly cases?: readonly EvaluationCase[];
    },
  ): EvaluationSuiteVersion {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationSuiteVersion.id is required.");
    }

    if (!props.evaluationSuiteId) {
      throw new DomainInvariantError(
        "EvaluationSuiteVersion.evaluationSuiteId is required.",
      );
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "EvaluationSuiteVersion.workspaceId is required.",
      );
    }

    return Object.freeze(
      new EvaluationSuiteVersion({
        id: props.id,
        evaluationSuiteId: props.evaluationSuiteId,
        workspaceId: props.workspaceId,
        version: requirePositiveInteger(
          props.version,
          "EvaluationSuiteVersion.version",
        ),
        cases: Object.freeze(props.cases ?? []),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
