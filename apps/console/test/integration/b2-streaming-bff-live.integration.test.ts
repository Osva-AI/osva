import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@osva/db";

import {
  consoleJson,
  resetM12_3Data,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  waitForRunSucceeded,
} from "./m12-3-harness.js";
import {
  launchStreamingRun,
  provisionModelStreamAgent,
} from "./b2-streaming-browser-helpers.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import { pollUntil } from "./poll-deadline.js";

async function readUntilReady(
  stack: Awaited<ReturnType<typeof startM12_3HumanConsoleStack>>,
  runId: string,
): Promise<{ readonly status: number; readonly sawReady: boolean }> {
  const controller = new AbortController();
  const response = await fetch(
    `${stack.consoleOrigin}/api/v1/runs/${encodeURIComponent(runId)}/stream`,
    {
      headers: {
        ...stack.consoleHeaders(stack.workspaceA),
        accept: "text/event-stream",
      },
      signal: controller.signal,
    },
  );
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("missing stream body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let sawReady = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("event: ready")) {
      sawReady = true;
      break;
    }
  }
  controller.abort();
  return { status: response.status, sawReady };
}

describe("B2 Console BFF live stream (real stack)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("opens SSE through Console BFF before run completes", async () => {
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
      runLiveStreamEnabled: true,
    });
    try {
      const fixture = await provisionModelStreamAgent(stack, {
        agentKey: "b2-bff-live",
        fixtureFilename: "model-stream-browser-hold-agent.ts",
      });
      const { runId } = await launchStreamingRun(stack, fixture);

      await pollUntil({
        label: "BFF stream attach run active",
        deadlineMs: 60_000,
        probe: async () => {
          const run = await consoleJson(
            stack,
            stack.workspaceA,
            `/api/v1/runs/${encodeURIComponent(runId)}`,
          );
          const status = (run.body as { status?: string }).status;
          return {
            done:
              status === "QUEUED" ||
              status === "RUNNING" ||
              status === "PENDING",
            lastState: status,
          };
        },
      });

      const stream = await readUntilReady(stack, runId);
      expect(stream.status).toBe(200);
      expect(stream.sawReady).toBe(true);

      await waitForRunSucceeded(stack, stack.workspaceA, runId);
    } finally {
      await stack.close();
    }
  });
});
