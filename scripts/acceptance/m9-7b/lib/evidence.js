import fs from "node:fs/promises";
import path from "node:path";

import { redactValue } from "./redact.js";

export async function createEvidenceLayout(rootDir) {
  const dirs = [
    rootDir,
    path.join(rootDir, "environment"),
    path.join(rootDir, "scenarios"),
    path.join(rootDir, "postgres"),
    path.join(rootDir, "valkey"),
    path.join(rootDir, "application-logs"),
    path.join(rootDir, "telemetry"),
    path.join(rootDir, "security"),
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function writeJson(filePath, value) {
  const sanitized = redactValue(value);
  await fs.writeFile(
    filePath,
    `${JSON.stringify(sanitized, null, 2)}\n`,
    "utf8",
  );
}

export function createScenarioResult(name, startedAt) {
  return {
    name,
    status: "NOT_RUN",
    startedAt,
    finishedAt: undefined,
    durationMs: undefined,
    assertions: [],
    error: undefined,
    evidence: {},
  };
}

export function finalizeScenarioResult(result, status, finishedAt) {
  const end =
    finishedAt instanceof Date ? finishedAt : new Date(String(finishedAt));
  const start =
    result.startedAt instanceof Date
      ? result.startedAt
      : new Date(String(result.startedAt));
  result.status = status;
  result.finishedAt = end.toISOString();
  result.durationMs = end.getTime() - start.getTime();
  return result;
}

export async function writeSummaryMd(reportPath, summaryPath) {
  const raw = await fs.readFile(reportPath, "utf8");
  const report = JSON.parse(raw);
  const lines = [
    "# M9.7B acceptance summary",
    "",
    `- Run id: ${report.runId}`,
    `- Verdict: **${report.verdict}**`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt ?? "(incomplete)"}`,
    "",
    "## Scenarios",
    "",
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `- ${scenario.name}: **${scenario.status}** (${String(scenario.durationMs ?? 0)}ms)`,
    );
    if (scenario.error) {
      lines.push(`  - Error: ${scenario.error}`);
    }
  }
  lines.push("");
  if (report.optionalSummary) {
    lines.push(
      `- Optional summary: blocked=${report.optionalSummary.blocked ?? 0}, notRun=${report.optionalSummary.notRun ?? 0}, failed=${report.optionalSummary.failed ?? 0}`,
    );
    lines.push("");
  }
  if (report.cleanup) {
    lines.push(`- Cleanup: ${report.cleanup.status}`);
    if (report.cleanup.retainedResources?.length > 0) {
      lines.push("- Retained resources:");
      for (const resource of report.cleanup.retainedResources) {
        lines.push(`  - ${resource}`);
      }
    }
  }
  await fs.writeFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
}
