import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  startFakeOpenAIResponsesServer,
  type FakeOpenAIResponsesServer,
} from "../../../../adapters/model-openai/test/fake-openai-server.js";

const execFileAsync = promisify(execFile);

export const LITELLM_ACCEPTANCE_MASTER_KEY = "sk-osva-litellm-acceptance";
export const LITELLM_PROXY_IMAGE =
  "docker.litellm.ai/berriai/litellm:main-v1.63.11-stable";
export const LITELLM_PROXY_IMAGE_DIGEST =
  "sha256:27c487bc6b4e15f0c09016679c65cbe82d533e42c613c951de743d658f41485d";

const FIXTURE_CONFIG = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/acceptance/litellm/fixtures/litellm-acceptance-config.yaml",
);

export interface LitellmLiveStack {
  readonly proxyBaseUrl: string;
  readonly masterKey: string;
  readonly fakeOpenAI: FakeOpenAIResponsesServer;
  readonly image: string;
  readonly imageDigest: string;
  assertTraversedProxy(): void;
  teardown(): Promise<void>;
}

export async function findDockerBin(): Promise<string | undefined> {
  const candidates = [
    "docker",
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    ),
    path.join(process.env.USERPROFILE ?? "", ".docker", "bin", "docker.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate !== "docker" && !fs.existsSync(candidate)) {
      continue;
    }
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function writeRuntimeConfig(upstreamV1: string): Promise<string> {
  const template = await fsPromises.readFile(FIXTURE_CONFIG, "utf8");
  const rendered = template.replaceAll("__FAKE_UPSTREAM_V1__", upstreamV1);
  const configPath = path.join(
    os.tmpdir(),
    `osva-litellm-acceptance-${randomUUID()}.yaml`,
  );
  await fsPromises.writeFile(configPath, rendered, "utf8");
  return configPath;
}

async function resolvePublishedPort(
  dockerBin: string,
  containerName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(dockerBin, [
        "port",
        containerName,
        "4000/tcp",
      ]);
      const match = stdout.match(/:(\d+)\s*$/m);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Timed out resolving port for ${containerName}`);
}

async function waitForProxyHealth(proxyBaseUrl: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  const url = `${proxyBaseUrl.replace(/\/$/, "")}/health/liveliness`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(500);
  }
  throw new Error(`LiteLLM proxy not healthy at ${url}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startLitellmLiveStack(): Promise<LitellmLiveStack> {
  const dockerBin = await findDockerBin();
  if (!dockerBin) {
    throw new Error("Docker CLI not found; live LiteLLM acceptance blocked");
  }
  await execFileAsync(dockerBin, ["info"]);

  const fakeOpenAI = await startFakeOpenAIResponsesServer();
  const fakeUrl = new URL(fakeOpenAI.origin);
  const upstreamV1 = `http://host.docker.internal:${String(fakeUrl.port)}/v1`;
  const configPath = await writeRuntimeConfig(upstreamV1);

  const runId = randomUUID().slice(0, 8);
  const containerName = `osva-litellm-acceptance-${runId}`;
  await execFileAsync(dockerBin, ["rm", "-f", containerName]).catch(
    () => undefined,
  );

  const args = [
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    "osva.acceptance.litellm=true",
    "--label",
    `osva.acceptance.litellm.run=${runId}`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--publish",
    "127.0.0.1::4000",
    "-e",
    `LITELLM_MASTER_KEY=${LITELLM_ACCEPTANCE_MASTER_KEY}`,
    "-v",
    `${configPath}:/app/config.yaml:ro`,
    LITELLM_PROXY_IMAGE,
    "--config",
    "/app/config.yaml",
  ];
  await execFileAsync(dockerBin, args);
  const hostPort = await resolvePublishedPort(dockerBin, containerName);
  const proxyBaseUrl = `http://127.0.0.1:${hostPort}`;

  await waitForProxyHealth(proxyBaseUrl);

  let proxyCallCount = 0;
  const probe = await fetch(`${proxyBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${LITELLM_ACCEPTANCE_MASTER_KEY}` },
  });
  if (probe.ok) {
    proxyCallCount += 1;
  }

  return {
    proxyBaseUrl,
    masterKey: LITELLM_ACCEPTANCE_MASTER_KEY,
    fakeOpenAI,
    image: LITELLM_PROXY_IMAGE,
    imageDigest: LITELLM_PROXY_IMAGE_DIGEST,
    assertTraversedProxy() {
      expectUpstreamViaProxy();
    },
    async teardown() {
      await fakeOpenAI.close();
      await execFileAsync(dockerBin, ["rm", "-f", containerName]).catch(
        () => undefined,
      );
      await fsPromises.unlink(configPath).catch(() => undefined);
    },
  };

  function expectUpstreamViaProxy() {
    if (fakeOpenAI.requests.length === 0) {
      throw new Error(
        "Expected upstream fake OpenAI to receive traffic via LiteLLM",
      );
    }
    void proxyCallCount;
  }
}

export function litellmConnectionEndpoint(proxyBaseUrl: string): string {
  return `${proxyBaseUrl.replace(/\/$/, "")}/v1`;
}

export function providerModelCounts(
  requests: Array<{ body: unknown }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const request of requests) {
    const body = request.body;
    if (body === null || typeof body !== "object" || !("model" in body)) {
      continue;
    }
    const model = (body as { model?: string }).model;
    if (typeof model !== "string") {
      continue;
    }
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return counts;
}

export async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(200);
  }
  throw new Error("waitUntil timed out");
}
