import { describe, expect, it } from "vitest";

import { projectModelStreamEventToViewer } from "../src/run-live-stream.js";
import {
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  type ModelStreamEvent,
} from "../src/model-streaming.js";

describe("run live stream viewer projection", () => {
  it("denies text deltas unless trusted policy enables them", () => {
    const event: ModelStreamEvent = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "s1",
      sequence: 0,
      kind: "TEXT_DELTA",
      textDelta: "hello",
    };
    expect(projectModelStreamEventToViewer(event)).toEqual({
      kind: "STREAM_STATUS",
      status: "receiving",
    });
    expect(
      projectModelStreamEventToViewer(event, { textDeltasVisible: true }),
    ).toEqual({
      kind: "TEXT_DELTA",
      textDelta: "hello",
    });
  });

  it("denies tool argument deltas to viewers", () => {
    const event: ModelStreamEvent = {
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: "s1",
      sequence: 1,
      kind: "TOOL_CALL_ARGUMENTS_DELTA",
      toolCallIndex: 0,
      argumentsDelta: '{"secret":true}',
    };
    expect(projectModelStreamEventToViewer(event)).toBeUndefined();
    expect(
      projectModelStreamEventToViewer(event, { textDeltasVisible: true }),
    ).toBeUndefined();
  });
});
