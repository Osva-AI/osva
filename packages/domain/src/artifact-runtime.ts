import type { Readable } from "node:stream";
import type {
  ArtifactId,
  JsonObject,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import { ARTIFACT_REFERENCE_TYPE } from "@osva/contracts";

import type { Artifact } from "./artifact.js";
import { ArtifactWorkspaceMismatchError } from "./errors.js";
import type {
  ArtifactApplication,
  CreateArtifactCommand,
  OpenArtifactContentResult,
} from "./artifact-application.js";
import { runtimeControlPlaneScope } from "./control-plane.js";

export interface RuntimeExecutionIdentity {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}

export interface RuntimeArtifactView {
  readonly id: ArtifactId;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly metadata: JsonObject;
  readonly reference: {
    readonly type: typeof ARTIFACT_REFERENCE_TYPE;
    readonly artifactId: ArtifactId;
  };
}

export interface CreateRuntimeArtifactCommand {
  readonly execution: RuntimeExecutionIdentity;
  readonly name: string;
  readonly mediaType: string;
  readonly content: Readable;
  readonly metadata?: JsonObject;
  readonly idempotencyKey?: string;
  readonly expectedDigest?: string;
}

export function runtimeArtifactIdempotencyKey(
  runAttemptId: RunAttemptId,
  callerKey: string | undefined,
): string | undefined {
  if (callerKey === undefined) {
    return undefined;
  }

  return `artifact-runtime:${runAttemptId}:${callerKey}`;
}

export function toRuntimeArtifactView(artifact: Artifact): RuntimeArtifactView {
  return {
    id: artifact.id,
    name: artifact.name,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
    digest: artifact.digest,
    metadata: artifact.metadata,
    reference: {
      type: ARTIFACT_REFERENCE_TYPE,
      artifactId: artifact.id,
    },
  };
}

export class CreateRuntimeArtifact {
  constructor(private readonly artifacts: ArtifactApplication) {}

  async execute(
    command: CreateRuntimeArtifactCommand,
  ): Promise<RuntimeArtifactView> {
    const createCommand: CreateArtifactCommand = {
      workspaceId: command.execution.workspaceId,
      name: command.name,
      mediaType: command.mediaType,
      metadata: command.metadata,
      content: command.content,
      expectedDigest: command.expectedDigest,
      idempotencyKey: runtimeArtifactIdempotencyKey(
        command.execution.runAttemptId,
        command.idempotencyKey,
      ),
      producerRunId: command.execution.runId,
      producerRunAttemptId: command.execution.runAttemptId,
    };

    const scope = runtimeControlPlaneScope(command.execution.workspaceId);
    const artifact = await this.artifacts.createArtifact.execute(
      scope,
      createCommand,
    );
    return toRuntimeArtifactView(artifact);
  }
}

export class GetRuntimeArtifact {
  constructor(private readonly artifacts: ArtifactApplication) {}

  async execute(
    artifactId: ArtifactId,
    execution: RuntimeExecutionIdentity,
  ): Promise<RuntimeArtifactView> {
    const scope = runtimeControlPlaneScope(execution.workspaceId);
    const artifact = await this.artifacts.getArtifact.execute(
      scope,
      artifactId,
    );
    assertWorkspaceAccess(artifact, execution.workspaceId);
    return toRuntimeArtifactView(artifact);
  }
}

export class OpenRuntimeArtifactContent {
  constructor(private readonly artifacts: ArtifactApplication) {}

  async execute(
    artifactId: ArtifactId,
    execution: RuntimeExecutionIdentity,
  ): Promise<OpenArtifactContentResult> {
    const scope = runtimeControlPlaneScope(execution.workspaceId);
    const artifact = await this.artifacts.getArtifact.execute(
      scope,
      artifactId,
    );
    assertWorkspaceAccess(artifact, execution.workspaceId);
    return this.artifacts.openArtifactContent.execute(scope, artifactId);
  }
}

export interface RuntimeArtifactApplication {
  readonly createRuntimeArtifact: CreateRuntimeArtifact;
  readonly getRuntimeArtifact: GetRuntimeArtifact;
  readonly openRuntimeArtifactContent: OpenRuntimeArtifactContent;
}

export function createRuntimeArtifactApplication(
  artifacts: ArtifactApplication,
): RuntimeArtifactApplication {
  return {
    createRuntimeArtifact: new CreateRuntimeArtifact(artifacts),
    getRuntimeArtifact: new GetRuntimeArtifact(artifacts),
    openRuntimeArtifactContent: new OpenRuntimeArtifactContent(artifacts),
  };
}

function assertWorkspaceAccess(
  artifact: Artifact,
  workspaceId: WorkspaceId,
): void {
  if (artifact.workspaceId !== workspaceId) {
    throw new ArtifactWorkspaceMismatchError(artifact.id, workspaceId);
  }
}
