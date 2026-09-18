import { RUNTIME_PROTOCOL_MAX_BODY_BYTES } from "@osva/runtime-protocol";

/**
 * Maximum bytes captured from container stdout for one RuntimeExecuteResponse.
 * Matches Runtime Protocol V1 body limits.
 */
export const CONTAINER_PROTOCOL_STDOUT_MAX_BYTES =
  RUNTIME_PROTOCOL_MAX_BODY_BYTES;

/**
 * Maximum bytes captured from container stderr for diagnostic output.
 * Excess stderr is discarded without failing execution unless stdout is valid.
 */
export const CONTAINER_PROTOCOL_STDERR_MAX_BYTES = 65_536;
