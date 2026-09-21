/** Structured security-event names for OSVA control-plane observability. */
export const SECURITY_EVENT_NAMES = {
  AUTH_AUTHENTICATION_FAILED: "auth.authentication_failed",
  AUTH_AUTHORIZATION_DENIED: "auth.authorization_denied",
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  CONNECTOR_EGRESS_DENIED: "connector.egress_denied",
  CONNECTOR_STDIO_DENIED: "connector.stdio_denied",
  CONNECTOR_SECRET_RESOLUTION_FAILED: "connector.secret_resolution_failed",
  CONNECTOR_DISCOVERY_FAILED: "connector.discovery_failed",
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

export function setSecurityEventSink(sink: SecurityEventSink): void {
  activeSink = sink;
}

export function resetSecurityEventSink(): void {
  activeSink = defaultSink;
}

export function emitSecurityEvent(fields: Readonly<SecurityEventFields>): void {
  activeSink(fields);
}
