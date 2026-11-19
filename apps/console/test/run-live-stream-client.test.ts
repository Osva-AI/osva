import { describe, expect, it } from "vitest";

import {
  applyRunLiveSseMessage,
  parseSseBlock,
  RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS,
} from "../src/client/lib/run-live-stream-client.js";
import { RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION } from "@osva-ai/contracts";

const baseEnvelope = {
  formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
  workspaceId: "ws-1",
  runId: "run-1",
  runAttemptId: "ra-1",
  streamId: "stream-1",
  sequence: 0,
  emittedAt: new Date().toISOString(),
};

describe("run live stream client", () => {
  it("parses ready events", () => {
    const message = parseSseBlock('event: ready\ndata: {"replay":false}\n');
    expect(message?.event).toBe("ready");
  });

  it("applies TEXT_DELTA when schema-valid", () => {
    const aggregate = applyRunLiveSseMessage(
      {
        partialText: "",
        textVisible: false,
        statusOnly: true,
        lastSequence: undefined,
        streamId: undefined,
        historyGap: false,
      },
      {
        event: "run-live",
        data: {
          ...baseEnvelope,
          viewerEvent: { kind: "TEXT_DELTA", textDelta: "hi" },
        },
      },
      "run-1",
    );
    expect(aggregate.partialText).toBe("hi");
    expect(aggregate.textVisible).toBe(true);
  });

  it("rejects tool-like payloads not in schema", () => {
    const aggregate = applyRunLiveSseMessage(
      {
        partialText: "",
        textVisible: false,
        statusOnly: true,
        lastSequence: undefined,
        streamId: undefined,
        historyGap: false,
      },
      {
        event: "run-live",
        data: {
          ...baseEnvelope,
          viewerEvent: {
            kind: "TOOL_CALL",
            argumentsDelta: '{"secret":true}',
          },
        },
      },
      "run-1",
    );
    expect(aggregate.partialText).toBe("");
  });

  it("detects sequence gaps", () => {
    const first = applyRunLiveSseMessage(
      {
        partialText: "",
        textVisible: false,
        statusOnly: true,
        lastSequence: undefined,
        streamId: "s1",
        historyGap: false,
      },
      {
        event: "run-live",
        data: {
          ...baseEnvelope,
          sequence: 0,
          streamId: "s1",
          viewerEvent: { kind: "STREAM_STATUS", status: "receiving" },
        },
      },
      "run-1",
    );
    const second = applyRunLiveSseMessage(
      first,
      {
        event: "run-live",
        data: {
          ...baseEnvelope,
          sequence: 2,
          streamId: "s1",
          viewerEvent: { kind: "STREAM_STATUS", status: "receiving" },
        },
      },
      "run-1",
    );
    expect(second.historyGap).toBe(true);
  });

  it("bounds aggregate text", () => {
    const aggregate = applyRunLiveSseMessage(
      {
        partialText: "a".repeat(RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS - 1),
        textVisible: true,
        statusOnly: false,
        lastSequence: 0,
        streamId: "s1",
        historyGap: false,
      },
      {
        event: "run-live",
        data: {
          ...baseEnvelope,
          sequence: 1,
          viewerEvent: { kind: "TEXT_DELTA", textDelta: "bcdefghij" },
        },
      },
      "run-1",
    );
    expect(aggregate.partialText.length).toBe(
      RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS,
    );
    expect(aggregate.partialText.endsWith("b")).toBe(true);
  });
});
