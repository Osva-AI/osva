export type ValidateCheckStatus = "PASS" | "WARN" | "FAIL";

export interface ValidateCheck {
  readonly id: string;
  readonly status: ValidateCheckStatus;
  readonly message: string;
  readonly remediation?: string;
}

export type ValidateOverallResult = "pass" | "warn" | "fail";

export interface ValidateReport {
  readonly result: ValidateOverallResult;
  readonly projectDir: string;
  readonly checks: readonly ValidateCheck[];
}
