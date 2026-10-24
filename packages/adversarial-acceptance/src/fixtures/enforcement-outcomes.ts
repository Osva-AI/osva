/**
 * M14.4 test/report classifications — not production enums.
 *
 * - BLOCKED_BY_PLATFORM: trusted enforcement rejected the privileged operation.
 * - AUTHORIZED_BUT_UNSAFE: an allowed tool/action ran with attacker-influenced args.
 * - TEST_LIMITATION: fake-model or harness scope; does not prove real LLM robustness.
 */
export type AdversarialEnforcementOutcome =
  "BLOCKED_BY_PLATFORM" | "AUTHORIZED_BUT_UNSAFE" | "TEST_LIMITATION";

export interface AdversarialScenarioRecord {
  readonly id: string;
  readonly attackerControlledInput: string;
  readonly trustBoundary: string;
  readonly targetedOperation: string;
  readonly expectedEnforcement: AdversarialEnforcementOutcome;
  readonly observedOutcome: AdversarialEnforcementOutcome;
  readonly deterministic: boolean;
}
