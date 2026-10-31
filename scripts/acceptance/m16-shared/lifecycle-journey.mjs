import { readFile } from "node:fs/promises";
import path from "node:path";

import { redactSecrets } from "../m16-2d/redact.mjs";
import { runCli } from "./cli-runner.mjs";

/**
 * @param {import("../m16-2d/report.mjs").AcceptanceReport} report
 * @param {object} input
 * @param {string} input.cliBin
 * @param {string} input.installDir
 * @param {string} [input.consolePort]
 */
export async function runM16LifecycleJourney(report, input) {
  const { cliBin, installDir } = input;

  const status1 = runCli(cliBin, [
    "platform",
    "status",
    "--install-dir",
    installDir,
  ]);
  report.record(
    "platform_status",
    "platform status (running)",
    status1.status === 0 ? "PASS" : "WARN",
  );

  const envBefore = await readFile(path.join(installDir, ".env"), "utf8");

  const stop = runCli(cliBin, [
    "platform",
    "stop",
    "--install-dir",
    installDir,
  ]);
  report.record(
    "platform_stop",
    "platform stop",
    stop.status === 0 ? "PASS" : "FAIL",
  );

  const status2 = runCli(cliBin, [
    "platform",
    "status",
    "--install-dir",
    installDir,
    "--json",
  ]);
  report.record(
    "platform_status_stopped",
    "platform status after stop",
    status2.status === 1 ? "PASS" : "WARN",
  );

  const start = runCli(cliBin, [
    "platform",
    "start",
    "--install-dir",
    installDir,
  ]);
  report.record(
    "platform_start",
    "platform start (no pull/migrate)",
    start.status === 0 ? "PASS" : "FAIL",
  );

  const restart = runCli(cliBin, [
    "platform",
    "restart",
    "--install-dir",
    installDir,
  ]);
  report.record(
    "platform_restart",
    "platform restart",
    restart.status === 0 ? "PASS" : "FAIL",
  );

  const doctor = runCli(cliBin, [
    "platform",
    "doctor",
    "--install-dir",
    installDir,
  ]);
  report.record(
    "platform_doctor",
    "platform doctor",
    doctor.status === 0 ? "PASS" : "WARN",
  );

  const logs = runCli(cliBin, [
    "platform",
    "logs",
    "--install-dir",
    installDir,
    "--service",
    "web",
    "--tail",
    "20",
  ]);
  report.record(
    "platform_logs",
    "platform logs",
    logs.status === 0 ? "PASS" : "FAIL",
  );

  const envAfter = await readFile(path.join(installDir, ".env"), "utf8");
  report.record(
    "lifecycle_secrets_preserved",
    "Lifecycle commands preserve .env secrets",
    envBefore === envAfter ? "PASS" : "FAIL",
  );

  if (input.consolePort) {
    try {
      const response = await fetch(`http://127.0.0.1:${input.consolePort}/`);
      report.record(
        "console_after_restart",
        "Console reachable after restart",
        response.ok ? "PASS" : "FAIL",
        { detail: `status=${response.status}` },
      );
    } catch (error) {
      report.record(
        "console_after_restart",
        "Console reachable after restart",
        "FAIL",
        {
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
