import path from "node:path";
import { pathToFileURL } from "node:url";

import { waitUntil } from "./timeouts.js";
import { HOST_VALKEY_READY_TIMEOUT_MS } from "./constants.js";
import { getRepoRoot } from "./stack.js";

export async function waitForHostValkeyReady(
  valkeyUrl,
  timeoutMs = HOST_VALKEY_READY_TIMEOUT_MS,
) {
  const check = await loadCheckValkeyConnection();
  await waitUntil(
    async () => {
      try {
        await check(valkeyUrl);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeoutMs,
      message: "Host-side Valkey connectivity did not recover",
    },
  );
}

async function loadCheckValkeyConnection() {
  const modulePath = path.join(
    getRepoRoot(),
    "adapters/bullmq/dist/check-valkey-connection.js",
  );
  const module = await import(pathToFileURL(modulePath).href);
  return module.checkValkeyConnection;
}
