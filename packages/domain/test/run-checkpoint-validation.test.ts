import {
  CHECKPOINT_CORRUPT_ERROR_CODE,
  CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertCheckpointCompatible,
  assertCheckpointStateIntegrity,
  CheckpointValidationError,
  digestCheckpointPayload,
  validateDeclarativeCheckpointState,
} from "../src/run-checkpoint-validation.js";

describe("run checkpoint validation", () => {
  const validState = {
    schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
    messages: [{ role: "system" as const, content: "hi" }],
    modelInvocations: 1,
    toolInvocations: 0,
  };

  it("accepts valid declarative checkpoint state", () => {
    expect(validateDeclarativeCheckpointState(validState)).toBe(true);
  });

  it("rejects malformed checkpoint state", () => {
    expect(validateDeclarativeCheckpointState({ bad: true })).toBe(false);
    expect(validateDeclarativeCheckpointState(null)).toBe(false);
  });

  it("rejects incompatible envelope and binding digests", () => {
    expect(() =>
      assertCheckpointCompatible({
        expectedBindings: {
          agentVersionId: "av-1" as never,
          modelProfileVersionBindings: { primary: "mpv-1" },
          toolVersionBindings: {},
        },
        bindingDigest: "deadbeef",
        agentVersionId: "av-2" as never,
        envelopeVersion: "99",
        stateSchemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      }),
    ).toThrow(CheckpointValidationError);

    try {
      assertCheckpointCompatible({
        expectedBindings: {
          agentVersionId: "av-1" as never,
          modelProfileVersionBindings: { primary: "mpv-1" },
          toolVersionBindings: {},
        },
        bindingDigest: "deadbeef",
        agentVersionId: "av-1" as never,
        envelopeVersion: "1",
        stateSchemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: CHECKPOINT_INCOMPATIBLE_ERROR_CODE,
      });
    }
  });

  it("rejects corrupt payload digests", () => {
    expect(() =>
      assertCheckpointStateIntegrity(validState, "not-a-real-digest"),
    ).toThrow(CheckpointValidationError);

    try {
      assertCheckpointStateIntegrity(validState, "bad");
    } catch (error) {
      expect(error).toMatchObject({ code: CHECKPOINT_CORRUPT_ERROR_CODE });
    }

    const digest = digestCheckpointPayload(validState);
    expect(assertCheckpointStateIntegrity(validState, digest)).toEqual(
      validState,
    );
  });
});
