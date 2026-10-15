import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HELLO_AGENT_ENTRYPOINT } from "../scripts/lib/constants.js";
import { deployHelloAgentRuntime } from "../scripts/lib/deploy.js";
import { sha256IntegrityOfFile } from "../scripts/lib/integrity.js";

describe("Host trusted-runtime deploy", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot !== undefined) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("hashes installed bytes from the worker-visible path", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "osva-hello-host-"));
    const deployed = await deployHelloAgentRuntime({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "osva_ak_test",
      workspaceId: "ws-test",
      deployMode: "host",
      trustedRuntimeRoot: tempRoot,
      composeDir: "",
      composeProject: undefined,
      composeProjectNameEnv: undefined,
      runPollIntervalMs: 500,
      runPollTimeoutMs: 1000,
      message: "Hello OSVA",
    });

    const installedPath = path.join(tempRoot, HELLO_AGENT_ENTRYPOINT);
    const fromDisk = await sha256IntegrityOfFile(installedPath);
    expect(deployed.integrity).toBe(fromDisk);
  });
});
