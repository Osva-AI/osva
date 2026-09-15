import { afterEach, describe, expect, it } from "vitest";

import type { Database } from "@osva/db";

import { createWebProcess } from "../src/process.js";
import { createFakePingableQueue } from "./fake-queue.js";

function fakeDatabase(onClose: () => void): Database {
  return {
    sql: {} as Database["sql"],
    db: {} as Database["db"],
    ping: async () => undefined,
    close: async () => {
      onClose();
    },
  };
}

describe("createWebProcess", () => {
  const processes: ReturnType<typeof createWebProcess>[] = [];

  afterEach(async () => {
    await Promise.all(processes.splice(0).map((web) => web.stop()));
  });

  it("stops HTTP, queue, and database resources idempotently", async () => {
    let closeCalls = 0;
    let queueShutdowns = 0;
    const queue = createFakePingableQueue();
    const originalShutdown = queue.shutdown.bind(queue);
    queue.shutdown = async () => {
      queueShutdowns += 1;
      await originalShutdown();
    };

    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      () =>
        fakeDatabase(() => {
          closeCalls += 1;
        }),
      () => queue,
    );
    processes.push(web);

    const port = await web.listen();
    expect(port).toBeGreaterThan(0);

    await web.stop();
    await web.stop();
    expect(closeCalls).toBe(1);
    expect(queueShutdowns).toBe(1);
  });
});
