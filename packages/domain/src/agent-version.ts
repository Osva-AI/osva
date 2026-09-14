import type { AgentId, AgentManifestV1, AgentVersionId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  freezeClone,
  requirePositiveInteger,
} from "./internals.js";

export interface AgentVersionProps {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly version: number;
  readonly manifest: AgentManifestV1;
  readonly createdAt: Date;
}

export class AgentVersion {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly version: number;
  readonly manifest: AgentManifestV1;
  readonly createdAt: Date;

  private constructor(props: AgentVersionProps) {
    this.id = props.id;
    this.agentId = props.agentId;
    this.version = props.version;
    this.manifest = props.manifest;
    this.createdAt = props.createdAt;
  }

  static create(props: AgentVersionProps): AgentVersion {
    if (!props.id) {
      throw new DomainInvariantError("AgentVersion.id is required.");
    }

    if (!props.agentId) {
      throw new DomainInvariantError("AgentVersion.agentId is required.");
    }

    if (props.manifest === null || typeof props.manifest !== "object") {
      throw new DomainInvariantError(
        "AgentVersion.manifest must be a snapshot object.",
      );
    }

    return Object.freeze(
      new AgentVersion({
        id: props.id,
        agentId: props.agentId,
        version: requirePositiveInteger(props.version, "AgentVersion.version"),
        manifest: freezeClone(props.manifest),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
