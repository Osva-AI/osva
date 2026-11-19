import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRunLiveStream } from "../src/client/hooks/use-run-live-stream.js";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("useRunLiveStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects and applies ready + text delta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: ready\ndata: {"replay":false}\n\n',
          'event: run-live\ndata: {"formatVersion":"1","workspaceId":"ws-1","runId":"run-1","runAttemptId":"ra-1","streamId":"s1","sequence":0,"emittedAt":"2026-01-01T00:00:00.000Z","viewerEvent":{"kind":"TEXT_DELTA","textDelta":"hel"}}\n\n',
          'event: run-live\ndata: {"formatVersion":"1","workspaceId":"ws-1","runId":"run-1","runAttemptId":"ra-1","streamId":"s1","sequence":1,"emittedAt":"2026-01-01T00:00:00.000Z","viewerEvent":{"kind":"TEXT_DELTA","textDelta":"lo"}}\n\n',
          'event: run-live\ndata: {"formatVersion":"1","workspaceId":"ws-1","runId":"run-1","runAttemptId":"ra-1","streamId":"s1","sequence":2,"emittedAt":"2026-01-01T00:00:00.000Z","viewerEvent":{"kind":"STREAM_STATUS","status":"ended"}}\n\n',
        ]),
      ),
    );

    const { result } = renderHook(() =>
      useRunLiveStream({ runId: "run-1", runStatus: "RUNNING" }),
    );

    await waitFor(() => expect(result.current.phase).toBe("ENDED"));
    expect(result.current.partialText).toBe("hello");
    expect(result.current.textVisible).toBe(true);
  });

  it("enters UNAVAILABLE on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    const { result } = renderHook(() =>
      useRunLiveStream({ runId: "run-1", runStatus: "RUNNING" }),
    );

    await waitFor(() => expect(result.current.phase).toBe("UNAVAILABLE"));
  });

  it("stays IDLE when run is terminal", () => {
    const { result } = renderHook(() =>
      useRunLiveStream({ runId: "run-1", runStatus: "SUCCEEDED" }),
    );
    expect(result.current.phase).toBe("IDLE");
  });
});
