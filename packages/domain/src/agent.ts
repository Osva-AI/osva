import type { AgentId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface AgentProps {
  readonly id: AgentId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;
}

export class Agent {
  readonly id: AgentId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;

  private constructor(props: AgentProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.createdAt = props.createdAt;
  }

  static create(props: AgentProps): Agent {
    if (!props.id) {
      throw new DomainInvariantError("Agent.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Agent.workspaceId is required.");
    }

    return Object.freeze(
      new Agent({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Agent.key"),
        name: requireNonEmptyString(props.name, "Agent.name"),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
