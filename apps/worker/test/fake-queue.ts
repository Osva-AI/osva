import type { PingableJobQueue } from "@osva/adapters-bullmq";

export function createFakePingableQueue(): PingableJobQueue & {
  consumeCalls: number;
} {
  const queue = {
    consumeCalls: 0,
    async enqueue() {},
    async cancel() {},
    async consume() {
      queue.consumeCalls += 1;
    },
    async shutdown() {},
    async ping() {},
  };
  return queue;
}
