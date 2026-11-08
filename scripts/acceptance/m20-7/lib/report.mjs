import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { redactAcceptanceSecrets } from "../../m20-6/lib/redaction.mjs";

export const HARNESS_VERSION = "m20-7.2";

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
    `- Provider invocation attempts (metadata): ${payload.providerInvocationAttemptsObserved ?? 0}`,
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

  const scenarios = Array.isArray(payload.scenarios)
    ? payload.scenarios
    : Array.isArray(payload.results)
      ? payload.results
      : [];
  for (const row of scenarios) {
    const detail =
      row.builderErrorCode !== undefined
        ? ` (${row.builderErrorCode}${row.httpStatus !== undefined ? ` HTTP ${row.httpStatus}` : ""}${row.providerAttempts !== undefined ? ` attempts=${row.providerAttempts}` : ""})`
        : row.errorCode !== undefined
          ? ` (${row.errorCode})`
          : "";
    lines.push(`- **${row.id ?? "?"}**: ${row.status ?? "NOT_RUN"}${detail}`);
    const rowPd = row.providerDiagnostic;
    if (rowPd !== undefined && rowPd !== null && typeof rowPd === "object") {
      if (rowPd.providerHttpStatus !== undefined) {
        lines.push(
          `  - Provider HTTP status: ${String(rowPd.providerHttpStatus)}`,
        );
      }
      if (rowPd.providerErrorCode !== undefined) {
        lines.push(
          `  - Provider error code: ${String(rowPd.providerErrorCode)}`,
        );
      }
      if (rowPd.providerErrorParam !== undefined) {
        lines.push(
          `  - Provider error param: ${String(rowPd.providerErrorParam)}`,
        );
      }
      if (rowPd.modelGatewayErrorCode !== undefined) {
        lines.push(
          `  - Model gateway code: ${String(rowPd.modelGatewayErrorCode)}`,
        );
      }
    } else if (row.providerDiagnosticUnavailableReason !== undefined) {
      lines.push(
        `  - Provider diagnostic unavailable: ${String(row.providerDiagnosticUnavailableReason)}`,
      );
    }
  }

  if (
    payload.generationFailure !== undefined &&
    payload.generationFailure !== null
  ) {
    const gf = payload.generationFailure;
    lines.push("", "## Generation failure", "");
    lines.push(`- Builder error: ${gf.builderErrorCode ?? "?"}`);
    lines.push(`- HTTP status: ${gf.httpStatus ?? "?"}`);
    lines.push(`- Provider attempts: ${gf.providerAttempts ?? 0}`);
    if (
      gf.builderMessage !== undefined &&
      String(gf.builderMessage).length > 0
    ) {
      lines.push(`- Message: ${String(gf.builderMessage).slice(0, 300)}`);
    }
    const pd = gf.providerDiagnostic;
    if (pd !== undefined && pd !== null && typeof pd === "object") {
      if (pd.providerHttpStatus !== undefined) {
        lines.push(`- Provider HTTP status: ${String(pd.providerHttpStatus)}`);
      }
      if (pd.modelGatewayErrorCode !== undefined) {
        lines.push(`- Model gateway code: ${String(pd.modelGatewayErrorCode)}`);
      }
      if (pd.providerErrorType !== undefined) {
        lines.push(`- Provider error type: ${String(pd.providerErrorType)}`);
      }
      if (pd.providerErrorCode !== undefined) {
        lines.push(`- Provider error code: ${String(pd.providerErrorCode)}`);
      }
      if (pd.providerErrorParam !== undefined) {
        lines.push(`- Provider error param: ${String(pd.providerErrorParam)}`);
      }
      if (pd.providerRequestId !== undefined) {
        lines.push(`- Provider request id: ${String(pd.providerRequestId)}`);
      }
      lines.push(
        `- Provider HTTP observed: ${pd.providerHttpResponseObserved === true ? "yes" : "no"}`,
      );
    }
    const compileIssues = Array.isArray(gf.compileIssues)
      ? gf.compileIssues
      : [];
    if (compileIssues.length > 0) {
      lines.push("", "### Compile issues (final failure)", "");
      for (const issue of compileIssues.slice(0, 12)) {
        const loc =
          issue.nodeKey !== undefined
            ? ` node=${String(issue.nodeKey)}`
            : issue.edgeFrom !== undefined && issue.edgeTo !== undefined
              ? ` edge=${String(issue.edgeFrom)}->${String(issue.edgeTo)}`
              : issue.agentRef !== undefined
                ? ` agentRef=${String(issue.agentRef)}`
                : "";
        lines.push(
          `- ${String(issue.code ?? "?")} (${String(issue.severity ?? "?")})${loc}: ${String(issue.messagePreview ?? "").slice(0, 160)}`,
        );
      }
    }
    const attemptDiagnostics = Array.isArray(gf.attemptDiagnostics)
      ? gf.attemptDiagnostics
      : [];
    if (attemptDiagnostics.length > 0) {
      lines.push("", "### Attempt diagnostics", "");
      for (const attempt of attemptDiagnostics.slice(0, 4)) {
        lines.push(
          `- Attempt ${String(attempt.providerAttempt ?? "?")}: stage=${String(attempt.validationStage ?? "?")} code=${String(attempt.errorCode ?? "?")} afterRepair=${attempt.afterRepair === true ? "yes" : "no"} repairAttempted=${attempt.repairAttempted === true ? "yes" : "no"}`,
        );
        if (attempt.modelFinishReason !== undefined) {
          lines.push(`  - Finish reason: ${String(attempt.modelFinishReason)}`);
        }
        const attemptIssues = Array.isArray(attempt.compileIssues)
          ? attempt.compileIssues
          : [];
        for (const issue of attemptIssues.slice(0, 8)) {
          lines.push(
            `  - Compile: ${String(issue.code ?? "?")} ${String(issue.messagePreview ?? "").slice(0, 120)}`,
          );
        }
      }
    }
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
