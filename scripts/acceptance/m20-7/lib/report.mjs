import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { redactAcceptanceSecrets } from "../../m20-6/lib/redaction.mjs";

export const HARNESS_VERSION = "m20-7.1";

/**
 * @param {string} repoRoot
 * @param {Record<string, unknown>} payload
 */
export async function writeAcceptanceArtifacts(repoRoot, payload) {
  const dir = path.join(repoRoot, "artifacts", "m20-7");
  await fs.mkdir(dir, { recursive: true });
  const runId = String(payload.runId ?? randomUUID());
  const jsonPath = path.join(dir, "acceptance-results.json");
  const mdPath = path.join(dir, "acceptance-report.md");
  const stamped = {
    ...payload,
    runId,
    harnessVersion: HARNESS_VERSION,
    executionTimestamp: payload.executionTimestamp ?? new Date().toISOString(),
  };
  const sanitized = JSON.parse(
    redactAcceptanceSecrets(JSON.stringify(stamped)),
  );
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(sanitized, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(mdPath, renderMarkdown(sanitized), "utf8");
  return { jsonPath, mdPath, runId };
}

/**
 * @param {Record<string, unknown>} payload
 */
function renderMarkdown(payload) {
  const lines = [
    "# M20.7 Live builder validation",
    "",
    `- Run id: ${payload.runId ?? "?"}`,
    `- Harness: ${payload.harnessVersion ?? HARNESS_VERSION}`,
    `- Mode: ${payload.mode ?? "unknown"}`,
    `- Live provider calls (verified): ${payload.liveProviderCalls === true ? "yes" : "no"}`,
    `- Provider calls observed: ${payload.actualProviderCallsObserved ?? 0}`,
    `- Commit: ${payload.sourceCommit ?? "unknown"}`,
    `- Timestamp: ${payload.executionTimestamp ?? ""}`,
    "",
    "## Provenance",
    "",
    `- Live requested: ${payload.liveModeRequested === true}`,
    `- Live authorized: ${payload.liveModeAuthorized === true}`,
    `- Identity verified: ${payload.providerIdentityVerified === true}`,
    `- Verification: ${payload.verificationCode ?? "n/a"}`,
    "",
    "## Scenarios",
    "",
  ];

  const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
  for (const row of scenarios) {
    lines.push(`- **${row.id ?? "?"}**: ${row.status ?? "NOT_RUN"}`);
  }

  lines.push("", "## Notes", "", String(payload.notes ?? ""));
  return `${lines.join("\n")}\n`;
}

/**
 * Fail closed when a live run claims success without provenance.
 *
 * @param {Record<string, unknown>} payload
 */
export function assertLiveReportConsistency(payload) {
  if (payload.mode !== "live") {
    return;
  }
  if (
    payload.overallStatus === "PASS" &&
    payload.liveProviderCalls !== true &&
    payload.liveExecuteAttempted === true
  ) {
    throw new Error("LIVE_PASS_WITHOUT_VERIFIED_PROVIDER_PROVENANCE");
  }
  if (
    payload.allScenariosExecuted === true &&
    (payload.scenarioCount === 0 || payload.scenarioCount === undefined)
  ) {
    throw new Error("ALL_SCENARIOS_EXECUTED_WITH_ZERO_COUNT");
  }
}
