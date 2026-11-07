import fs from "node:fs/promises";
import path from "node:path";

import { redactAcceptanceSecrets } from "./redaction.mjs";

/**
 * @param {string} repoRoot
 * @param {Record<string, unknown>} payload
 */
export async function writeAcceptanceArtifacts(repoRoot, payload) {
  const dir = path.join(repoRoot, "artifacts", "m20-6");
  await fs.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, "acceptance-results.json");
  const mdPath = path.join(dir, "acceptance-report.md");
  const sanitized = JSON.parse(
    redactAcceptanceSecrets(JSON.stringify(payload)),
  );
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(sanitized, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(mdPath, renderMarkdown(sanitized), "utf8");
  return { jsonPath, mdPath };
}

/**
 * @param {Record<string, unknown>} payload
 */
function renderMarkdown(payload) {
  const mode = String(payload.mode ?? "unknown");
  const live = payload.liveProviderCalls === true;
  const lines = [
    "# M20.6 Builder product acceptance",
    "",
    `- Runner: ${payload.runnerVersion ?? "m20-6"}`,
    `- Mode: ${mode}`,
    `- Live provider calls: ${live ? "yes" : "no"}`,
    `- Commit: ${payload.sourceCommit ?? "unknown"}`,
    `- Timestamp: ${payload.executionTimestamp ?? ""}`,
    "",
    "## Scenarios",
    "",
  ];

  const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
  for (const row of scenarios) {
    const id = row.id ?? "?";
    const status = row.status ?? "NOT_RUN";
    lines.push(`- **${id}**: ${status}`);
  }

  lines.push("", "## Notes", "", String(payload.notes ?? ""));
  return `${lines.join("\n")}\n`;
}
