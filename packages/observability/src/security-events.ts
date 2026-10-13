import {
  NO_OP_INSTRUMENTATION,
  type OsvaInstrumentation,
} from "./instrumentation.js";
import { OSVA_METRIC } from "./metrics.js";

/** Structured security-event names for OSVA control-plane observability. */
export const SECURITY_EVENT_NAMES = {
  AUTH_AUTHENTICATION_FAILED: "auth.authentication_failed",
  AUTH_AUTHENTICATION_MISSING: "auth.authentication_missing",
  AUTH_AUTHORIZATION_DENIED: "auth.authorization_denied",
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  CONNECTOR_EGRESS_DENIED: "connector.egress_denied",
  CONNECTOR_STDIO_DENIED: "connector.stdio_denied",
  CONNECTOR_SECRET_RESOLUTION_FAILED: "connector.secret_resolution_failed",
  CONNECTOR_DISCOVERY_FAILED: "connector.discovery_failed",
  RATE_LIMIT_THROTTLED: "rate_limit.throttled",
  RATE_LIMIT_STORE_UNAVAILABLE: "rate_limit.store_unavailable",
  CONSOLE_INVALID_HOST: "console.invalid_host",
  CONSOLE_INVALID_ORIGIN: "console.invalid_origin",
  CONSOLE_CROSS_SITE_MUTATION: "console.cross_site_mutation",
  CONSOLE_REQUEST_TOO_LARGE: "console.request_too_large",
} as const;

export type SecurityEventName =
  (typeof SECURITY_EVENT_NAMES)[keyof typeof SECURITY_EVENT_NAMES];

export interface SecurityEventFields {
  readonly event: SecurityEventName;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly workspaceId?: string;
  readonly subjectId?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: string;
  readonly reasonCode?: string;
  readonly role?: string;
}

export type SecurityEventSink = (fields: Readonly<SecurityEventFields>) => void;

const defaultSink: SecurityEventSink = (fields) => {
  console.log(JSON.stringify(fields));
};

let activeSink: SecurityEventSink = defaultSink;
let securityInstrumentation: OsvaInstrumentation = NO_OP_INSTRUMENTATION;

export function setSecurityEventSink(sink: SecurityEventSink): void {
  activeSink = sink;
}

export function resetSecurityEventSink(): void {
  activeSink = defaultSink;
}

export function setSecurityEventInstrumentation(
  instrumentation: OsvaInstrumentation,
): void {
  securityInstrumentation = instrumentation;
}

export function resetSecurityEventInstrumentation(): void {
  securityInstrumentation = NO_OP_INSTRUMENTATION;
}

export function emitSecurityEvent(fields: Readonly<SecurityEventFields>): void {
  activeSink(fields);
  try {
    securityInstrumentation.recordCounter(OSVA_METRIC.SECURITY_EVENTS, 1, {
      event: fields.event,
      outcome: fields.outcome ?? "unknown",
    });
  } catch {
    // Security metrics must never fail the request.
  }
}
