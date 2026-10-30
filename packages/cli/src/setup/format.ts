import type { SetupReport } from "./setup-report.js";

export function formatSetupHuman(report: SetupReport): string {
  const lines: string[] = [
    "OSVA Setup",
    "",
    "Preflight checks and local Compose provisioning for self-hosted OSVA.",
    report.installDir !== undefined
      ? `Installation directory: ${report.installDir}`
      : undefined,
    "",
  ].filter((line): line is string => line !== undefined);

  for (const check of report.checks) {
    const status = check.status.padEnd(4, " ");
    const id = check.id.padEnd(26, " ");
    lines.push(`${status} ${id} ${check.message}`);
    if (check.remediation !== undefined) {
      lines.push(`      → ${check.remediation}`);
    }
  }
  lines.push("");
  lines.push(`Result: ${report.result.toUpperCase()}`);
  if (report.platformReady === true) {
    lines.push("Platform services: READY");
  } else if (report.phase === "provision") {
    lines.push("Platform services: NOT READY");
  }
  if (report.consoleReady === true) {
    lines.push("Console: READY");
  } else if (report.phase === "provision") {
    lines.push("Console: NOT READY");
  }
  if (report.administratorBootstrapped === true) {
    lines.push("Administrator bootstrap: DONE");
  } else if (report.phase === "provision") {
    lines.push("Administrator bootstrap: PENDING");
  }
  if (report.installationComplete === true) {
    lines.push("Installation: COMPLETE");
  } else {
    lines.push(
      "Installation: NOT COMPLETE (complete Console sign-in and Agent Studio onboarding).",
    );
  }
  if (report.setupTokenForOperator !== undefined) {
    lines.push("");
    lines.push("One-time administrator password setup token (single use):");
    lines.push(report.setupTokenForOperator);
    lines.push("");
    lines.push(
      "Enter this token at the Console /setup page. It is not stored in installation files or JSON output.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatSetupJson(report: SetupReport): string {
  const safeReport = Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== "setupTokenForOperator"),
  ) as Omit<SetupReport, "setupTokenForOperator">;
  return `${JSON.stringify(safeReport, null, 2)}\n`;
}
