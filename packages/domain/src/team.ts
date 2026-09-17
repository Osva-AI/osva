import type { TeamId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface TeamProps {
  readonly id: TeamId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateTeamProps {
  readonly id: TeamId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly now: Date;
}

export interface UpdateTeamProps {
  readonly name?: string;
  readonly description?: string;
  readonly now: Date;
}

export class Team {
  readonly id: TeamId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: TeamProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: CreateTeamProps): Team {
    if (!props.id) {
      throw new DomainInvariantError("Team.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Team.workspaceId is required.");
    }

    const now = copyInstant(props.now);

    return Object.freeze(
      new Team({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Team.key"),
        name: requireNonEmptyString(props.name, "Team.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(props.description, "Team.description"),
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static rehydrate(props: TeamProps): Team {
    return Object.freeze(
      new Team({
        id: props.id,
        workspaceId: props.workspaceId,
        key: props.key,
        name: props.name,
        description: props.description,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  update(props: UpdateTeamProps): Team {
    const name =
      props.name === undefined
        ? this.name
        : requireNonEmptyString(props.name, "Team.name");
    const description =
      props.description === undefined ? this.description : props.description;

    return Team.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      description:
        description === undefined
          ? undefined
          : requireNonEmptyString(description, "Team.description"),
      createdAt: this.createdAt,
      updatedAt: copyInstant(props.now),
    });
  }
}
