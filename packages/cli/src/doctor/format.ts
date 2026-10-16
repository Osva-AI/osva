import type { DoctorReport } from "./types.js";

export function formatDoctorHuman(report: DoctorReport): string {
  const lines: string[] = ["OSVA Doctor", ""];
  for (const check of report.checks) {
    const status = check.status.padEnd(4, " ");
    const id = check.id.padEnd(22, " ");
    lines.push(`${status} ${id} ${check.message}`);
    if (check.remediation !== undefined) {
      lines.push(`      → ${check.remediation}`);
    }
  }
  lines.push("");
  lines.push(`Result: ${report.result.toUpperCase()}`);
  return `${lines.join("\n")}\n`;
}

export function formatDoctorJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
