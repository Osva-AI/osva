import type { ValidateReport } from "./types.js";

export function formatValidateHuman(report: ValidateReport): string {
  const lines: string[] = [
    "OSVA Validate",
    "",
    `Project: ${report.projectDir}`,
    "",
  ];
  for (const check of report.checks) {
    const status = check.status.padEnd(4, " ");
    const id = check.id.padEnd(28, " ");
    lines.push(`${status} ${id} ${check.message}`);
    if (check.remediation !== undefined) {
      lines.push(`      → ${check.remediation}`);
    }
  }
  lines.push("");
  lines.push(`Result: ${report.result.toUpperCase()}`);
  return `${lines.join("\n")}\n`;
}

export function formatValidateJson(report: ValidateReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
