import type { ModelProfileId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface ModelProfileProps {
  readonly id: ModelProfileId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;
}

export class ModelProfile {
  readonly id: ModelProfileId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;

  private constructor(props: ModelProfileProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.createdAt = props.createdAt;
  }

  static create(props: ModelProfileProps): ModelProfile {
    if (!props.id) {
      throw new DomainInvariantError("ModelProfile.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("ModelProfile.workspaceId is required.");
    }

    return Object.freeze(
      new ModelProfile({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "ModelProfile.key"),
        name: requireNonEmptyString(props.name, "ModelProfile.name"),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }

  withName(name: string): ModelProfile {
    return ModelProfile.create({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      createdAt: this.createdAt,
    });
  }
}
