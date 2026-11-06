import {
  CHECKPOINT_CORRUPT_ERROR_CODE,
  CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
  RUN_CHECKPOINT_ENVELOPE_VERSION,
  RUN_CHECKPOINT_MAX_STATE_BYTES,
  type DeclarativeRuntimeCheckpointStateV1,
  type JsonValue,
  type RunCheckpointBindingIdentity,
} from "@osva-ai/contracts";
import { createHash } from "node:crypto";

import { canonicalJsonStringify } from "./json-equality.js";

export function digestRunCheckpointBindings(
  identity: RunCheckpointBindingIdentity,
): string {
  const canonical = JSON.stringify({
    agentVersionId: identity.agentVersionId,
    modelProfileVersionBindings: sortRecord(
      identity.modelProfileVersionBindings,
    ),
    toolVersionBindings: sortRecord(identity.toolVersionBindings),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function digestCheckpointPayload(
  state: DeclarativeRuntimeCheckpointStateV1,
): string {
  return createHash("sha256")
    .update(canonicalJsonStringify(state as unknown as JsonValue), "utf8")
    .digest("hex");
}

export function validateDeclarativeCheckpointState(
  state: unknown,
): state is DeclarativeRuntimeCheckpointStateV1 {
  if (state === null || typeof state !== "object") {
    return false;
  }
  const candidate = state as DeclarativeRuntimeCheckpointStateV1;
  if (candidate.schemaVersion !== DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION) {
    return false;
  }
  if (!Array.isArray(candidate.messages)) {
    return false;
  }
  if (
    typeof candidate.modelInvocations !== "number" ||
    typeof candidate.toolInvocations !== "number"
  ) {
    return false;
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, "utf8") > RUN_CHECKPOINT_MAX_STATE_BYTES) {
    return false;
  }
  return true;
}

export class CheckpointValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CheckpointValidationError";
    this.code = code;
  }
}

export function assertCheckpointCompatible(input: {
  readonly expectedBindings: RunCheckpointBindingIdentity;
  readonly bindingDigest: string;
  readonly agentVersionId: string;
  readonly envelopeVersion: string;
  readonly stateSchemaVersion: string;
}): void {
  if (input.envelopeVersion !== RUN_CHECKPOINT_ENVELOPE_VERSION) {
    throw new CheckpointValidationError(
      CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
      "Unsupported checkpoint envelope version.",
    );
  }
  if (
    input.stateSchemaVersion !== DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION
  ) {
    throw new CheckpointValidationError(
      CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
      "Unsupported checkpoint state schema version.",
    );
  }
  if (input.agentVersionId !== input.expectedBindings.agentVersionId) {
    throw new CheckpointValidationError(
      CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
      "Checkpoint agent version does not match effective bindings.",
    );
  }
  const expectedDigest = digestRunCheckpointBindings(input.expectedBindings);
  if (input.bindingDigest !== expectedDigest) {
    throw new CheckpointValidationError(
      CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
      "Checkpoint binding digest does not match effective bindings.",
    );
  }
}

export function assertCheckpointStateIntegrity(
  state: unknown,
  payloadDigest: string,
): DeclarativeRuntimeCheckpointStateV1 {
  if (!validateDeclarativeCheckpointState(state)) {
    throw new CheckpointValidationError(
      CHECKPOINT_CORRUPT_ERROR_CODE,
      "Checkpoint state failed schema validation.",
    );
  }
  const digest = digestCheckpointPayload(state);
  if (digest !== payloadDigest) {
    throw new CheckpointValidationError(
      CHECKPOINT_CORRUPT_ERROR_CODE,
      "Checkpoint payload digest mismatch.",
    );
  }
  return state;
}

function sortRecord(
  record: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sortedKeys = Object.keys(record).sort();
  const sorted: Record<string, string> = {};
  for (const key of sortedKeys) {
    sorted[key] = record[key]!;
  }
  return sorted;
}
