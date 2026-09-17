import type { EvaluationSuiteId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface EvaluationSuiteProps {
  readonly id: EvaluationSuiteId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class EvaluationSuite {
  readonly id: EvaluationSuiteId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: EvaluationSuiteProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: EvaluationSuiteProps): EvaluationSuite {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationSuite.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "EvaluationSuite.workspaceId is required.",
      );
    }

    return Object.freeze(
      new EvaluationSuite({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "EvaluationSuite.key"),
        name: requireNonEmptyString(props.name, "EvaluationSuite.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(
                props.description,
                "EvaluationSuite.description",
              ),
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }
}
