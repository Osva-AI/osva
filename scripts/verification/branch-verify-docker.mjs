import { isDockerEngineReady, probeDockerEngine } from "./docker-preflight.mjs";

/**
 * @param {Awaited<ReturnType<typeof import("./environment.mjs").loadEnvironment>>} env
 * @param {typeof import("./environment.mjs").runSpec} runSpec
 */
export async function dockerAvailable(env, runSpec) {
  if (!env.docker?.source) {
    return false;
  }
  const spec = { command: env.docker.source, prefixArgs: [] };
  const probe = await probeDockerEngine(spec, runSpec);
  return isDockerEngineReady(probe);
}

/**
 * @param {import("./branch-impact.mjs").IntegrationObligation} obligation
 * @param {"fast" | "integration"} profile
 * @param {boolean} dockerOk
 * @returns {{ readonly action: "run" | "defer" | "skip-docker"; readonly detail?: string }}
 */
export function planObligationExecution(obligation, profile, dockerOk) {
  if (profile !== "integration" || !obligation.runInIntegrationProfile) {
    return { action: "defer", detail: obligation.reason };
  }
  if (obligation.requiresDocker && !dockerOk) {
    return {
      action: "skip-docker",
      detail:
        "Docker engine unavailable — start Docker or use CI for this obligation.",
    };
  }
  return { action: "run" };
}
