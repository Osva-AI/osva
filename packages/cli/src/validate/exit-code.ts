import type { ValidateReport } from "./types.js";

export function validateExitCode(report: ValidateReport): number {
  return report.result === "fail" ? 1 : 0;
}
