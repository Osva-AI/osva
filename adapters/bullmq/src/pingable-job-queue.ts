import type { JobQueue } from "@osva-ai/contracts";

export type PingableJobQueue = JobQueue & {
  ping(): Promise<void>;
};
