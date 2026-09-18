/**
 * Explicit container environment. Containers must not inherit worker process.env.
 * RuntimeExecuteRequest is delivered via the execution bootstrap capability.
 */
export const CONTAINER_MINIMAL_ENV: readonly string[] = [];
