import {
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  type ModelStreamEvent,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  createTrustedAgentModels,
  dispatchParentModelMessage,
} from "../src/model-capability.js";

function streamEvent(
  partial: Partial<ModelStreamEvent> & Pick<ModelStreamEvent, "kind">,
): ModelStreamEvent {
  return {
    streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
    streamId: "stream-1",
    sequence: 0,
    ...partial,
  } as ModelStreamEvent;
}

describe("model capability stream iterator", () => {
  it("closes when a terminal event arrives while next() is waiting", async () => {
    let callId: string | undefined;
    process.send = ((message: unknown) => {
      const record = message as Record<string, unknown>;
      if (record.type === "model.generate.stream.request") {
        callId = record.callId as string;
      }
      return true;
    }) as typeof process.send;

    const models = createTrustedAgentModels();
    const iterator = models
      .generateCompletionStream("primary", {
        messages: [{ role: "user", content: "hello" }],
      })
      [Symbol.asyncIterator]();

    const pendingNext = iterator.next();

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(callId).toBeDefined();

    dispatchParentModelMessage({
      v: 1,
      type: "model.generate.stream.event",
      callId: callId!,
      event: streamEvent({
        kind: "COMPLETED",
        finishReason: "stop",
        sequence: 0,
      }),
    });

    const terminal = await pendingNext;
    expect(terminal.done).toBe(false);
    expect(terminal.value?.kind).toBe("COMPLETED");

    const closed = await iterator.next();
    expect(closed.done).toBe(true);
  });
});
