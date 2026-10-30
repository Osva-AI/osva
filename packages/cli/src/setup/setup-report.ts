import type { DoctorCheck, DoctorReport } from "../doctor/types.js";

export interface SetupReport extends DoctorReport {
  readonly installDir?: string;
  readonly platformReady?: boolean;
  readonly installationComplete?: boolean;
  readonly consoleReady?: boolean;
  readonly administratorBootstrapped?: boolean;
  readonly phase: "preflight" | "provision";
  /** Excluded from JSON diagnostics; human output only. */
  readonly setupTokenForOperator?: string;
}

export function mergeSetupReport(input: {
  readonly preflight: DoctorReport;
  readonly provisionChecks?: readonly DoctorCheck[];
  readonly installDir: string;
  readonly phase: "preflight" | "provision";
  readonly setupTokenForOperator?: string;
}): SetupReport {
  const checks = input.provisionChecks
    ? [...input.preflight.checks, ...input.provisionChecks]
    : input.preflight.checks;
  const result = finalizeResult(checks);
  const platformReady = checks.some(
    (check) =>
      check.id === "platform_services_ready" && check.status === "PASS",
  );
  const installationComplete = checks.some(
    (check) => check.id === "installation_complete" && check.status === "PASS",
  );
  const consoleReady = checks.some(
    (check) => check.id === "console_ready" && check.status === "PASS",
  );
  const administratorBootstrapped = checks.some(
    (check) =>
      check.id === "administrator_bootstrapped" && check.status === "PASS",
  );
  return {
    result,
    checks,
    installDir: input.installDir,
    platformReady,
    installationComplete,
    consoleReady,
    administratorBootstrapped,
    phase: input.phase,
    ...(input.setupTokenForOperator === undefined
      ? {}
      : { setupTokenForOperator: input.setupTokenForOperator }),
  };
}

function finalizeResult(
  checks: readonly DoctorCheck[],
): DoctorReport["result"] {
  const hasFail = checks.some((check) => check.status === "FAIL");
  const hasWarn = checks.some((check) => check.status === "WARN");
  if (hasFail) {
    return "fail";
  }
  if (hasWarn) {
    return "warn";
  }
  return "pass";
}
