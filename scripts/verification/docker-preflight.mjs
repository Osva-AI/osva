/** @typedef {'cli-unavailable' | 'engine-unavailable' | 'engine-ready'} DockerEngineState */

export const DOCKER_ENGINE_PROBE_ARGS = ["info"];

/** Upper bound for `docker info` during verify:doctor / verify:docker preflight. */
export const DOCKER_ENGINE_PROBE_TIMEOUT_MS = 15_000;

const ENGINE_HINT_MAX = 400;

/**
 * @param {string} text
 */
export function trimEngineHint(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= ENGINE_HINT_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, ENGINE_HINT_MAX - 3)}...`;
}

/**
 * @param {{ version?: string, compose?: string, engine?: DockerEngineState, engineHint?: string }} docker
 * @returns {string[]}
 */
export function dockerReadinessFailures(docker) {
  const failures = [];
  if (!docker.version) {
    failures.push(
      "Docker CLI is not available. Install Docker Desktop or add docker to PATH.",
    );
    return failures;
  }
  if (!docker.compose) {
    failures.push(
      "Docker Compose is not available. Install a Docker build that includes `docker compose` (Docker Desktop or Docker Engine plugin).",
    );
  }
  if (docker.engine === "engine-unavailable") {
    const hint = docker.engineHint
      ? ` ${docker.engineHint}`
      : " Start Docker Desktop or the Docker Engine service, then retry.";
    failures.push(
      `Docker CLI is installed but the engine is not running.${hint}`,
    );
  } else if (docker.engine !== "engine-ready") {
    failures.push(
      "Docker engine readiness could not be determined. Run `docker info` locally for details.",
    );
  }
  return failures;
}

/**
 * @param {import('./environment.mjs').CommandSpec} spec
 * @param {(spec: import('./environment.mjs').CommandSpec, args: readonly string[], options?: object) => Promise<{ code: number, stdout: string, stderr: string }>} runSpec
 */
export async function probeDockerEngine(spec, runSpec) {
  const result = await runSpec(spec, DOCKER_ENGINE_PROBE_ARGS, {
    stdio: "pipe",
    timeoutMs: DOCKER_ENGINE_PROBE_TIMEOUT_MS,
  });
  if (result.code === 0) {
    const serverLine = result.stdout
      .split(/\r?\n/)
      .find((line) => /^Server Version:/i.test(line));
    return {
      engine: /** @type {const} */ ("engine-ready"),
      engineHint: serverLine?.trim(),
    };
  }
  const combined = trimEngineHint(
    [result.stderr, result.stdout].filter(Boolean).join("\n"),
  );
  return {
    engine: /** @type {const} */ ("engine-unavailable"),
    engineHint: combined || "docker info failed.",
  };
}
