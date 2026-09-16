import type {
  InternalToolImplementationId,
  ToolId,
  ToolType,
  ToolVersionId,
} from "@osva/contracts";
import { isInternalToolImplementationId, isToolType } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./internals.js";

export interface ToolVersionProps {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: ToolType;
  readonly implementation: InternalToolImplementationId;
  readonly createdAt: Date;
}

export class ToolVersion {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: ToolType;
  readonly implementation: InternalToolImplementationId;
  readonly createdAt: Date;

  private constructor(props: ToolVersionProps) {
    this.id = props.id;
    this.toolId = props.toolId;
    this.version = props.version;
    this.type = props.type;
    this.implementation = props.implementation;
    this.createdAt = props.createdAt;
  }

  static create(props: ToolVersionProps): ToolVersion {
    if (!props.id) {
      throw new DomainInvariantError("ToolVersion.id is required.");
    }

    if (!props.toolId) {
      throw new DomainInvariantError("ToolVersion.toolId is required.");
    }

    if (!isToolType(props.type)) {
      throw new DomainInvariantError(
        "ToolVersion.type must be a supported tool type.",
      );
    }

    if (!isInternalToolImplementationId(props.implementation)) {
      throw new DomainInvariantError(
        "ToolVersion.implementation must be a known internal implementation.",
      );
    }

    return Object.freeze(
      new ToolVersion({
        id: props.id,
        toolId: props.toolId,
        version: requirePositiveInteger(props.version, "ToolVersion.version"),
        type: props.type,
        implementation: requireNonEmptyString(
          props.implementation,
          "ToolVersion.implementation",
        ) as InternalToolImplementationId,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
