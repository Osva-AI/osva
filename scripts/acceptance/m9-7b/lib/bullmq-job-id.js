import path from "node:path";
import { pathToFileURL } from "node:url";

import { getRepoRoot } from "./stack.js";

export async function toBullMqJobIdFromDist(runAttemptId) {
  const modulePath = path.join(getRepoRoot(), "adapters/bullmq/dist/job-id.js");
  const module = await import(pathToFileURL(modulePath).href);
  return module.toBullMqJobId(runAttemptId);
}
