import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunAttemptId, RunId, WorkspaceId } from "@osva-ai/contracts";
import {
  RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
  runLiveStreamChannelName,
} from "@osva-ai/contracts";

import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../bullmq/test/integration/valkey-harness.js";
import {
  ValkeyRunLiveStreamPublisher,
  ValkeyRunLiveStreamSubscription,
} from "../../src/valkey-run-live-stream.js";

describe("ValkeyRunLiveStream", () => {
  let valkey: ValkeyTestContext;

  beforeAll(async () => {
    valkey = await startValkeyForTests();
  }, 30_000);

  afterAll(async () => {
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  function sampleEnvelope(sequence: number) {
    const workspaceId = "ws-valkey" as WorkspaceId;
    const runId = randomUUID() as RunId;
    const runAttemptId = randomUUID() as RunAttemptId;
    return {
      formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
      workspaceId,
      runId,
      runAttemptId,
      streamId: "stream-1",
      sequence,
      emittedAt: new Date().toISOString(),
      viewerEvent: {
        kind: "STREAM_STATUS" as const,
        status: "receiving" as const,
      },
    };
  }

  it("delivers envelopes on the workspace/run channel with monotonic sequences", async () => {
    const first = sampleEnvelope(0);
    const second = {
      ...sampleEnvelope(1),
      workspaceId: first.workspaceId,
      runId: first.runId,
      runAttemptId: first.runAttemptId,
      streamId: first.streamId,
      sequence: 1,
    };

    const received: number[] = [];
    const subscription = new ValkeyRunLiveStreamSubscription({
      url: valkey.url,
      workspaceId: first.workspaceId,
      runId: first.runId,
      onEnvelope(envelope) {
        received.push(envelope.sequence);
      },
    });

    const publisher = new ValkeyRunLiveStreamPublisher({ url: valkey.url });
    await subscription.start();
    await subscription.waitUntilReady();
    await publisher.connect();

    publisher.tryPublish(first);
    publisher.tryPublish(second);

    await waitUntil(() => received.length >= 2);

    expect(received).toEqual([0, 1]);
    expect(runLiveStreamChannelName(first.workspaceId, first.runId)).toContain(
      first.workspaceId,
    );

    await subscription.stop();
    await publisher.close();
  });

  it("ignores envelopes for a different workspace or run", async () => {
    const envelope = sampleEnvelope(0);
    const otherRunId = randomUUID() as RunId;

    const received: unknown[] = [];
    const subscription = new ValkeyRunLiveStreamSubscription({
      url: valkey.url,
      workspaceId: envelope.workspaceId,
      runId: envelope.runId,
      onEnvelope(en) {
        received.push(en);
      },
    });
    const publisher = new ValkeyRunLiveStreamPublisher({ url: valkey.url });
    await subscription.start();
    await subscription.waitUntilReady();
    await publisher.connect();

    publisher.tryPublish({
      ...envelope,
      runId: otherRunId,
    });

    await delay(200);
    expect(received).toHaveLength(0);

    await subscription.stop();
    await publisher.close();
  });
});

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for Valkey Pub/Sub delivery.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
