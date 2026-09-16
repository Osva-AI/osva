import type { JobQueue } from "@osva/contracts";

export type PingableJobQueue = JobQueue & {
  ping(): Promise<void>;
};
