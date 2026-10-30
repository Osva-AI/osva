import type { DoctorReport } from "../doctor/types.js";
import type { LifecycleActionResult } from "./lifecycle.js";
import type { PlatformStatusReport } from "./types.js";

export function formatPlatformStatusHuman(
  report: PlatformStatusReport,
): string {
  const lines: string[] = [];
  const { installation } = report;
  lines.push(`Installation: ${installation.installDir}`);
  lines.push(`Image: ${installation.marker.imageRef}`);
  lines.push(`Platform version: ${installation.marker.platformVersion}`);
  lines.push(`Compose project: ${installation.marker.composeProjectName}`);
  lines.push(`Control plane: ${installation.webUrl}`);
  lines.push(`Console: ${installation.consoleUrl}`);
  lines.push(
    `Platform ready: ${report.platformReady ? "yes" : "no"} (API /ready: ${report.apiReadyOk ? "ok" : "not ok"})`,
  );
  lines.push(`Console ready: ${report.consoleReady ? "yes" : "no"}`);
  lines.push("");
  lines.push("Services:");
  if (report.services.length === 0) {
    lines.push("  (no containers reported — installation may be stopped)");
  } else {
    for (const service of report.services) {
      lines.push(
        `  ${service.name.padEnd(22)} ${service.state.padEnd(10)} ${service.statusText}`,
      );
    }
  }
  if (report.upgradeState !== undefined) {
    lines.push(
      `Upgrade state: ${report.upgradeState.phase} (${report.upgradeState.fromPlatformVersion} → ${report.upgradeState.toPlatformVersion})`,
    );
  }
  if (report.problems.length > 0) {
    lines.push("");
    lines.push("Problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatPlatformStatusJson(report: PlatformStatusReport): string {
  return `${JSON.stringify(
    {
      installDir: report.installation.installDir,
      imageRef: report.installation.marker.imageRef,
      platformVersion: report.installation.marker.platformVersion,
      composeProjectName: report.installation.marker.composeProjectName,
      webUrl: report.installation.webUrl,
      mcpUrl: report.installation.mcpUrl,
      consoleUrl: report.installation.consoleUrl,
      platformReady: report.platformReady,
      consoleReady: report.consoleReady,
      apiHealthOk: report.apiHealthOk,
      apiReadyOk: report.apiReadyOk,
      services: report.services,
      problems: report.problems,
      upgradeState: report.upgradeState,
    },
    null,
    2,
  )}\n`;
}

export function formatLifecycleHuman(result: LifecycleActionResult): string {
  return `${result.message}\n`;
}

export function formatLifecycleJson(result: LifecycleActionResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatPlatformDoctorHuman(report: DoctorReport): string {
  const lines: string[] = ["OSVA platform doctor", ""];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.id}: ${check.message}`);
    if (check.remediation !== undefined) {
      lines.push(`  → ${check.remediation}`);
    }
  }
  lines.push("");
  lines.push(`Result: ${report.result}`);
  return `${lines.join("\n")}\n`;
}

export function formatPlatformDoctorJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
