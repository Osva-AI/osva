import type {
  AgentId,
  AgentVersionId,
  DeploymentId,
  WorkspaceId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface DeploymentProps {
  readonly id: DeploymentId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly environment: string;
  readonly createdAt: Date;
}

export class Deployment {
  readonly id: DeploymentId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly environment: string;
  readonly createdAt: Date;

  private constructor(props: DeploymentProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.agentId = props.agentId;
    this.agentVersionId = props.agentVersionId;
    this.environment = props.environment;
    this.createdAt = props.createdAt;
  }

  static create(props: DeploymentProps): Deployment {
    if (!props.id) {
      throw new DomainInvariantError("Deployment.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Deployment.workspaceId is required.");
    }

    if (!props.agentId) {
      throw new DomainInvariantError("Deployment.agentId is required.");
    }

    if (!props.agentVersionId) {
      throw new DomainInvariantError("Deployment.agentVersionId is required.");
    }

    return Object.freeze(
      new Deployment({
        id: props.id,
        workspaceId: props.workspaceId,
        agentId: props.agentId,
        agentVersionId: props.agentVersionId,
        environment: requireNonEmptyString(
          props.environment,
          "Deployment.environment",
        ),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
