import { writeJson } from "./evidence.js";

export function createScenarioEvidenceBase(ctx, scenarioId) {
  return {
    scenarioId,
    runId: ctx.runId,
    infrastructure: {
      provenance: "local-source-built-web-worker",
      artifactSource: "local-build",
      postgresContainer: ctx.infra?.postgres?.containerName,
      valkeyContainer: ctx.infra?.valkey?.containerName,
      valkeyUrlRedacted: ctx.infra?.valkey?.urlRedacted,
      stableValkeyUrlRedacted: ctx.infra?.valkey?.stableUrlRedacted,
    },
    assertions: [],
    faultInjectionPoint: undefined,
    recoveryMs: undefined,
    cleanup: undefined,
  };
}

export async function writeScenarioEvidence(ctx, scenarioId, payload) {
  const filePath = `${ctx.evidenceDir}/scenarios/${scenarioId}-evidence.json`;
  await writeJson(filePath, payload);
  return filePath;
}

export function recordAssertion(evidence, name, pass, detail = undefined) {
  evidence.assertions.push({
    name,
    pass,
    detail,
  });
}
