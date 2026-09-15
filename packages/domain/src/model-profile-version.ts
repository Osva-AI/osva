import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProvider,
} from "@osva/contracts";
import { isModelProvider } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./internals.js";

export interface ModelProfileVersionProps {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly createdAt: Date;
}

export class ModelProfileVersion {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly createdAt: Date;

  private constructor(props: ModelProfileVersionProps) {
    this.id = props.id;
    this.modelProfileId = props.modelProfileId;
    this.version = props.version;
    this.provider = props.provider;
    this.model = props.model;
    this.createdAt = props.createdAt;
  }

  static create(props: ModelProfileVersionProps): ModelProfileVersion {
    if (!props.id) {
      throw new DomainInvariantError("ModelProfileVersion.id is required.");
    }

    if (!props.modelProfileId) {
      throw new DomainInvariantError(
        "ModelProfileVersion.modelProfileId is required.",
      );
    }

    if (!isModelProvider(props.provider)) {
      throw new DomainInvariantError(
        "ModelProfileVersion.provider must be a supported provider.",
      );
    }

    return Object.freeze(
      new ModelProfileVersion({
        id: props.id,
        modelProfileId: props.modelProfileId,
        version: requirePositiveInteger(
          props.version,
          "ModelProfileVersion.version",
        ),
        provider: props.provider,
        model: requireNonEmptyString(props.model, "ModelProfileVersion.model"),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
