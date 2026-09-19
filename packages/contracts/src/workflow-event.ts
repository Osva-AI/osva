/** Bounded untrusted WorkflowEvent identity fields (Stage 3.2 / 3.3). */
export const WORKFLOW_EVENT_SOURCE_MAX_LENGTH = 128;
export const WORKFLOW_EVENT_TYPE_MAX_LENGTH = 128;
export const WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH = 512;
export const WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH = 256;

/** Maximum UTF-8 byte size of a POST /v1/workflow-events JSON body. */
export const WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES = 256 * 1024;
