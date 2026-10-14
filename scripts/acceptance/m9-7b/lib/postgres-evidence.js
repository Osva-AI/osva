import { execInContainer } from "./docker.js";

function escapeLiteral(value) {
  return String(value).replaceAll("'", "''");
}

export async function queryRunAttemptRow(dockerBin, infra, runAttemptId) {
  const sql = `
SELECT
  id,
  run_id,
  status,
  execution_owner,
  execution_generation,
  lease_expires_at,
  error->>'code' AS error_code,
  error->>'message' AS error_message
FROM run_attempts
WHERE id = '${escapeLiteral(runAttemptId)}'
LIMIT 1;`.trim();
  const stdout = await execInContainer(
    dockerBin,
    infra.postgres.containerName,
    infra.runId,
    [
      "psql",
      "-U",
      "osva",
      "-d",
      "osva_acceptance",
      "-t",
      "-A",
      "-F",
      "|",
      "-c",
      sql,
    ],
  );
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return null;
  }
  const [
    id,
    runId,
    status,
    executionOwner,
    executionGeneration,
    leaseExpiresAt,
    errorCode,
    errorMessage,
  ] = line.split("|");
  return {
    id,
    runId,
    status,
    executionOwner: executionOwner || null,
    executionGeneration: executionGeneration
      ? Number.parseInt(executionGeneration, 10)
      : null,
    leaseExpiresAt: leaseExpiresAt || null,
    error: errorCode
      ? { code: errorCode, message: errorMessage ?? "" }
      : undefined,
  };
}

export async function countRunAttemptsForRun(dockerBin, infra, runId) {
  const sql = `SELECT COUNT(*) FROM run_attempts WHERE run_id = '${escapeLiteral(runId)}';`;
  const stdout = await execInContainer(
    dockerBin,
    infra.postgres.containerName,
    infra.runId,
    ["psql", "-U", "osva", "-d", "osva_acceptance", "-t", "-A", "-c", sql],
  );
  return Number.parseInt(stdout.trim(), 10);
}
