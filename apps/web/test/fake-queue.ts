import type { PingableJobQueue } from "@osva/adapters-bullmq";

export function createFakePingableQueue(): PingableJobQueue & {
  readonly enqueueCalls: string[];
  readonly consumeCalls: number;
} {
  const enqueueCalls: string[] = [];
  let consumeCalls = 0;
  const queue: PingableJobQueue & {
    readonly enqueueCalls: string[];
    readonly consumeCalls: number;
  } = {
    get enqueueCalls() {
      return enqueueCalls;
    },
    get consumeCalls() {
      return consumeCalls;
    },
    async enqueue(runAttemptId) {
      enqueueCalls.push(runAttemptId);
    },
    async cancel() {},
    async consume() {
      consumeCalls += 1;
    },
    async shutdown() {},
    async ping() {},
  };
  return queue;
}
