export type DoctorCheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly remediation?: string;
}

export type DoctorOverallResult = "pass" | "warn" | "fail";

export interface DoctorReport {
  readonly result: DoctorOverallResult;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorEnv {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly workspaceId?: string;
}

export interface DoctorProbeOptions {
  readonly fetch?: typeof fetch;
  readonly probeTimeoutMs?: number;
}
