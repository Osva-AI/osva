import {
  emitSecurityEvent,
  SECURITY_EVENT_NAMES,
  type SecurityEventName,
} from "@osva/observability";

import type { ConsoleRequestGuardResult } from "./request-guard.js";

export function emitConsoleRequestGuardDenial(
  guard: Extract<ConsoleRequestGuardResult, { allowed: false }>,
): void {
  emitSecurityEvent({
    event: eventForGuardReason(guard.reason),
    outcome: "DENIED",
    reasonCode: guard.reason,
  });
}

export function emitConsoleRequestTooLarge(): void {
  emitSecurityEvent({
    event: SECURITY_EVENT_NAMES.CONSOLE_REQUEST_TOO_LARGE,
    outcome: "DENIED",
    reasonCode: "request_too_large",
  });
}

function eventForGuardReason(
  reason: Extract<ConsoleRequestGuardResult, { allowed: false }>["reason"],
): SecurityEventName {
  switch (reason) {
    case "forwarded_host":
    case "invalid_host":
      return SECURITY_EVENT_NAMES.CONSOLE_INVALID_HOST;
    case "cross_site_mutation":
      return SECURITY_EVENT_NAMES.CONSOLE_CROSS_SITE_MUTATION;
    case "invalid_origin":
      return SECURITY_EVENT_NAMES.CONSOLE_INVALID_ORIGIN;
  }
}
