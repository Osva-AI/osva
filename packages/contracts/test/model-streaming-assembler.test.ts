import { describe, expect, it } from "vitest";

import {
  MODEL_ERROR_CODES,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  assembleModelStreamCompletion,
  type ModelStreamEvent,
} from "../src/index.js";
import { modelStreamEventSchema } from "../src/schemas/model-streaming.js";

const STREAM_ID = "stream-test-1";

type ModelStreamEventBody = Omit<
  ModelStreamEvent,
  "streamFormatVersion" | "streamId" | "sequence"
>;

function eventAt<T extends ModelStreamEventBody>(
  sequence: number,
  payload: T,
): ModelStreamEvent {
  return {
    streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
    streamId: STREAM_ID,
    sequence,
    ...payload,
  } as ModelStreamEvent;
}

describe("assembleModelStreamCompletion", () => {
  it("reconstructs text from ordered deltas", () => {
    const events: ModelStreamEvent[] = [
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "hello " }),
      eventAt(1, { kind: "TEXT_DELTA", textDelta: "world" }),
      eventAt(2, { kind: "COMPLETED", finishReason: "stop" }),
    ];
    const outcome = assembleModelStreamCompletion(events);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.text).toBe("hello world");
      expect(outcome.result.toolCalls).toEqual([]);
    }
  });

  it("allows empty text deltas", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "" }),
      eventAt(1, { kind: "TEXT_DELTA", textDelta: "x" }),
      eventAt(2, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.text).toBe("x");
    }
  });

  it("reconstructs tool calls from argument deltas", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, {
        kind: "TOOL_CALL_START",
        toolCallIndex: 0,
        toolCallId: "tc-1",
        name: "search",
      }),
      eventAt(1, {
        kind: "TOOL_CALL_ARGUMENTS_DELTA",
        toolCallIndex: 0,
        argumentsDelta: '{"q":',
      }),
      eventAt(2, {
        kind: "TOOL_CALL_ARGUMENTS_DELTA",
        toolCallIndex: 0,
        argumentsDelta: '"osva"}',
      }),
      eventAt(3, { kind: "COMPLETED", finishReason: "tool_call" }),
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.toolCalls).toEqual([
        { id: "tc-1", name: "search", arguments: { q: "osva" } },
      ]);
    }
  });

  it("rejects invalid tool argument JSON", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, {
        kind: "TOOL_CALL_START",
        toolCallIndex: 0,
        toolCallId: "tc-1",
        name: "search",
      }),
      eventAt(1, {
        kind: "TOOL_CALL_ARGUMENTS_DELTA",
        toolCallIndex: 0,
        argumentsDelta: "{not-json",
      }),
      eventAt(2, { kind: "COMPLETED", finishReason: "tool_call" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "INVALID_TOOL_ARGUMENTS" });
  });

  it("rejects duplicate terminal completion", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "a" }),
      eventAt(1, { kind: "COMPLETED", finishReason: "stop" }),
      eventAt(2, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "TERMINAL_NOT_LAST" });
  });

  it("rejects missing terminal", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "a" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "MISSING_TERMINAL" });
  });

  it("surfaces provider failure terminal", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, {
        kind: "FAILED",
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        message: "upstream error",
      }),
    ]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("STREAM_FAILED");
      expect(outcome.code).toBe(MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR);
    }
  });

  it("surfaces cancellation terminal", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "CANCELLED", reason: "EXECUTION_CANCELLED" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "STREAM_CANCELLED" });
  });

  it("rejects partial success without text or tools", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "PARTIAL_SUCCESS_REJECTED" });
  });

  it("accepts terminal-only usage when reported", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "ok" }),
      eventAt(1, {
        kind: "USAGE_FINAL",
        usage: { inputUnits: 3, outputUnits: 1 },
        invocationSource: "PROVIDER_INVOKED",
      }),
      eventAt(2, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.usage).toEqual({ inputUnits: 3, outputUnits: 1 });
      expect(outcome.invocationSource).toBe("PROVIDER_INVOKED");
    }
  });

  it("rejects duplicate usage events", () => {
    const outcome = assembleModelStreamCompletion([
      eventAt(0, { kind: "TEXT_DELTA", textDelta: "ok" }),
      eventAt(1, {
        kind: "USAGE_FINAL",
        usage: { inputUnits: 1, outputUnits: 1 },
      }),
      eventAt(2, {
        kind: "USAGE_FINAL",
        usage: { inputUnits: 2, outputUnits: 2 },
      }),
      eventAt(3, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome).toEqual({ ok: false, reason: "DUPLICATE_USAGE" });
  });

  it("rejects unsupported format version", () => {
    const outcome = assembleModelStreamCompletion([
      {
        streamFormatVersion: "99",
        streamId: STREAM_ID,
        sequence: 0,
        kind: "TEXT_DELTA",
        textDelta: "x",
      } as unknown as ModelStreamEvent,
      eventAt(1, { kind: "COMPLETED", finishReason: "stop" }),
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: "UNSUPPORTED_FORMAT_VERSION",
    });
  });
});

describe("modelStreamEventSchema", () => {
  it("rejects events carrying credential-like keys", () => {
    const parsed = modelStreamEventSchema.safeParse({
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: STREAM_ID,
      sequence: 0,
      kind: "TEXT_DELTA",
      textDelta: "hello",
      apiKey: "sk-secret",
    });
    expect(parsed.success).toBe(false);
  });
});
