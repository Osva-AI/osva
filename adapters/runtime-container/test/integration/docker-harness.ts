import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { DockerApiClient } from "../../src/docker-api-client.js";
import {
  OSVA_CONTAINER_EXECUTION_ID_LABEL,
  OSVA_CONTAINER_MANAGED_LABEL,
} from "../../src/labels.js";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const EXAMPLE_LOCAL_DOCKER_IMAGE = "osva-container-runtime-python:build";
const EXAMPLE_RUNTIME_REPOSITORY = "local.test/osva-container-runtime-python";

export interface ExampleContainerImageFixture {
  /**
   * Canonical OSVA-style digest-pinned reference used in ExecutionRequest /
   * AgentVersion tests. Not a registry manifest digest; aliased to the local
   * tag inside integration Docker client wrappers only.
   */
  readonly runtimeImageReference: string;
  readonly localDockerImage: string;
}

function testDigestFromDockerImageId(dockerImageId: string): string {
  const normalized = dockerImageId.startsWith("sha256:")
    ? dockerImageId.slice("sha256:".length)
    : dockerImageId;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new Error(
      `Expected Docker image ID to yield a 64-hex test digest, got ${JSON.stringify(dockerImageId)}.`,
    );
  }
  return normalized.toLowerCase();
}

export async function buildExampleContainerImage(): Promise<ExampleContainerImageFixture> {
  const dockerfile = path.join(
    repoRoot,
    "examples",
    "container-runtime-python",
    "Dockerfile",
  );
  await execFileAsync(
    "docker",
    ["build", "-f", dockerfile, "-t", EXAMPLE_LOCAL_DOCKER_IMAGE, repoRoot],
    {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const { stdout } = await execFileAsync(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", EXAMPLE_LOCAL_DOCKER_IMAGE],
    { timeout: 30_000 },
  );
  const testDigest = testDigestFromDockerImageId(stdout.trim());
  return {
    runtimeImageReference: `${EXAMPLE_RUNTIME_REPOSITORY}@sha256:${testDigest}`,
    localDockerImage: EXAMPLE_LOCAL_DOCKER_IMAGE,
  };
}

/**
 * Maps one canonical integration test image reference to a locally built tag.
 * Does not alias any other image string.
 */
export function createLocalImageAliasingDockerClient(options: {
  readonly delegate: DockerApiClient;
  readonly runtimeImageReference: string;
  readonly localDockerImage: string;
}): DockerApiClient {
  const resolveImage = (image: string): string =>
    image === options.runtimeImageReference ? options.localDockerImage : image;

  const { delegate } = options;

  return {
    ping: () => delegate.ping(),
    inspectImage: (image) => delegate.inspectImage(resolveImage(image)),
    pull: (image) => delegate.pull(resolveImage(image)),
    createContainer: (spec) =>
      delegate.createContainer({
        ...spec,
        Image: resolveImage(spec.Image),
      }),
    startContainer: (id) => delegate.startContainer(id),
    runContainerProtocolExecution: (id, runOptions) =>
      delegate.runContainerProtocolExecution(id, runOptions),
    stopContainer: (id) => delegate.stopContainer(id),
    killContainer: (id) => delegate.killContainer(id),
    removeContainer: (id) => delegate.removeContainer(id),
    listContainersByLabel: (label, value) =>
      delegate.listContainersByLabel(label, value),
  };
}

export async function listOsvaManagedContainers(
  executionId?: string,
): Promise<readonly { readonly id: string; readonly executionId?: string }[]> {
  const args = [
    "ps",
    "-a",
    "--filter",
    `label=${OSVA_CONTAINER_MANAGED_LABEL}=true`,
    "--format",
    "{{.ID}}",
  ];
  if (executionId !== undefined) {
    args.push(
      "--filter",
      `label=${OSVA_CONTAINER_EXECUTION_ID_LABEL}=${executionId}`,
    );
  }

  const { stdout } = await execFileAsync("docker", args, { timeout: 30_000 });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((id) => ({ id, executionId }));
}

export async function assertNoOsvaManagedContainers(
  executionId?: string,
): Promise<void> {
  const containers = await listOsvaManagedContainers(executionId);
  if (containers.length > 0) {
    throw new Error(
      `Expected no OSVA-managed containers${executionId === undefined ? "" : ` for ${executionId}`}, found ${String(containers.length)}.`,
    );
  }
}
