import type { GoalId, GoalState, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { assertLegalGoalTransition } from "./goal-state-machine.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface GoalProps {
  readonly id: GoalId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly status: GoalState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateGoalProps {
  readonly id: GoalId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly now: Date;
}

export interface UpdateGoalProps {
  readonly title?: string;
  readonly description?: string;
  readonly status?: GoalState;
  readonly now: Date;
}

export class Goal {
  readonly id: GoalId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly status: GoalState;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: GoalProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.title = props.title;
    this.description = props.description;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: CreateGoalProps): Goal {
    if (!props.id) {
      throw new DomainInvariantError("Goal.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Goal.workspaceId is required.");
    }

    const now = copyInstant(props.now);

    return Object.freeze(
      new Goal({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Goal.key"),
        title: requireNonEmptyString(props.title, "Goal.title"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(props.description, "Goal.description"),
        status: "OPEN",
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static rehydrate(props: GoalProps): Goal {
    return Object.freeze(
      new Goal({
        id: props.id,
        workspaceId: props.workspaceId,
        key: props.key,
        title: props.title,
        description: props.description,
        status: props.status,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  update(props: UpdateGoalProps): Goal {
    const title =
      props.title === undefined
        ? this.title
        : requireNonEmptyString(props.title, "Goal.title");
    const description =
      props.description === undefined ? this.description : props.description;
    const status = props.status ?? this.status;

    if (status !== this.status) {
      assertLegalGoalTransition(this.status, status);
    }

    return Goal.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      title,
      description:
        description === undefined
          ? undefined
          : requireNonEmptyString(description, "Goal.description"),
      status,
      createdAt: this.createdAt,
      updatedAt: copyInstant(props.now),
    });
  }
}
