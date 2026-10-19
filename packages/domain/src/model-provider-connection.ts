import type {
  ModelProvider,
  ModelProviderConnectionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { isModelProvider } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface ModelProviderConnectionProps {
  readonly id: ModelProviderConnectionId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly provider: ModelProvider;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ModelProviderConnection {
  readonly id: ModelProviderConnectionId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly provider: ModelProvider;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ModelProviderConnectionProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.provider = props.provider;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: ModelProviderConnectionProps): ModelProviderConnection {
    if (!props.id) {
      throw new DomainInvariantError("ModelProviderConnection.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "ModelProviderConnection.workspaceId is required.",
      );
    }

    if (!isModelProvider(props.provider)) {
      throw new DomainInvariantError(
        "ModelProviderConnection.provider must be a supported provider.",
      );
    }

    return Object.freeze(
      new ModelProviderConnection({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "ModelProviderConnection.key"),
        name: requireNonEmptyString(props.name, "ModelProviderConnection.name"),
        provider: props.provider,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  withName(name: string, updatedAt: Date): ModelProviderConnection {
    return ModelProviderConnection.create({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name: requireNonEmptyString(name, "ModelProviderConnection.name"),
      provider: this.provider,
      createdAt: this.createdAt,
      updatedAt: copyInstant(updatedAt),
    });
  }
}
