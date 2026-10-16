import { afterEach } from "vitest";

import { terminateTrackedSubprocesses } from "./run-cli-subprocess.js";

afterEach(async () => {
  await terminateTrackedSubprocesses();
});
