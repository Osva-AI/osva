import {
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  type ModelStreamEvent,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { isChildJsonValue } from "../src/child-json.js";
import { MODEL_STREAM_IPC_MAX_FRAME_BYTES } from "../src/constants.js";
import { validateModelStreamEventFrame } from "../src/model-stream-ipc.js";
import {
  isModelGenerateStreamEventMessage,
  isModelGenerateStreamRequestMessage,
} from "../src/protocol.js";

function baseEvent(
  partial: Partial<ModelStreamEvent> & Pick<ModelStreamEvent, "kind">,
): ModelStreamEvent {
  return {
    streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
    streamId: "stream-1",
    sequence: 0,
    ...partial,
  } as ModelStreamEvent;
}

describe("model stream IPC validation", () => {
  it("accepts a valid TEXT_DELTA frame", () => {
    const event = baseEvent({
      kind: "TEXT_DELTA",
      textDelta: "hello",
    });
    expect(validateModelStreamEventFrame(event)).toEqual(event);
  });

  it("rejects malformed frames", () => {
    expect(validateModelStreamEventFrame({ bogus: true })).toBeUndefined();
  });

  it("rejects oversized frames", () => {
    const huge = "x".repeat(MODEL_STREAM_IPC_MAX_FRAME_BYTES);
    const event = baseEvent({
      kind: "TEXT_DELTA",
      textDelta: huge,
    });
    expect(validateModelStreamEventFrame(event)).toBeUndefined();
  });

  it("validates stream IPC request messages", () => {
    const message = {
      v: 1,
      type: "model.generate.stream.request",
      callId: "call-1",
      binding: "primary",
      request: {
        messages: [{ role: "user", content: "hello" }],
      },
    };
    expect(isModelGenerateStreamRequestMessage(message)).toBe(true);
    expect(
      isModelGenerateStreamRequestMessage({
        v: 1,
        type: "model.generate.stream.request",
        callId: "call-2",
        binding: "primary",
        request: {
          messages: [
            { role: "system", content: "You are concise." },
            { role: "user", content: "stream-success-check" },
          ],
          maxOutputTokens: 500,
        },
      }),
    ).toBe(true);
    expect(
      isModelGenerateStreamRequestMessage({
        ...message,
        request: { ...message.request, signal: {} },
      }),
    ).toBe(false);
  });

  it("survives structuredClone round-trip for stream event envelopes", () => {
    const frame = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "ipc-test",
      sequence: 0,
      kind: "TEXT_DELTA",
      textDelta: "hi",
    };
    const message = {
      v: 1,
      type: "model.generate.stream.event",
      callId: "call-1",
      event: frame,
    };
    const roundTripped = structuredClone(message);
    expect(isModelGenerateStreamEventMessage(roundTripped)).toBe(true);
  });

  it("survives JSON IPC round-trip for stream event envelopes", () => {
    const frame = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "ipc-test",
      sequence: 0,
      kind: "TEXT_DELTA",
      textDelta: "hi",
    };
    const message = {
      v: 1,
      type: "model.generate.stream.event",
      callId: "call-1",
      event: frame,
    };
    const roundTripped = JSON.parse(JSON.stringify(message)) as unknown;
    expect(isModelGenerateStreamEventMessage(roundTripped)).toBe(true);
  });

  it("accepts stream events as child-safe JSON", () => {
    const frame = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "ipc-test",
      sequence: 0,
      kind: "TEXT_DELTA",
      textDelta: "hi",
    };
    expect(isChildJsonValue(frame)).toBe(true);
    expect(
      isModelGenerateStreamEventMessage({
        v: 1,
        type: "model.generate.stream.event",
        callId: "call-1",
        event: frame,
      }),
    ).toBe(true);
  });

  it("accepts adapter test COMPLETED frames", () => {
    const completed = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "ipc-test",
      sequence: 1,
      kind: "COMPLETED",
      finishReason: "stop",
    };
    expect(validateModelStreamEventFrame(completed)).toEqual(completed);
  });

  it("validates stream event envelopes", () => {
    const event = baseEvent({ kind: "COMPLETED", finishReason: "stop" });
    expect(
      isModelGenerateStreamEventMessage({
        v: 1,
        type: "model.generate.stream.event",
        callId: "call-1",
        event,
      }),
    ).toBe(true);
  });
});
