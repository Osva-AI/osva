export const REMOTE_RUNTIME_ENDPOINT_MAX_LENGTH = 2_048;

const HTTP_ENDPOINT_PATTERN =
  /^(https?):\/\/([^/?#]+)([^?#]*)?(\?[^#]*)?(#.*)?$/i;

/**
 * Privileged AgentVersion remote-runtime URL checks.
 * Rejects non-HTTP schemes, missing hosts, and userinfo-as-plaintext-credential.
 */
export function isAllowedRemoteRuntimeEndpoint(value: string): boolean {
  if (value.length === 0 || value.length > REMOTE_RUNTIME_ENDPOINT_MAX_LENGTH) {
    return false;
  }

  const match = HTTP_ENDPOINT_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const host = match[2];
  if (host === undefined || host.length === 0) {
    return false;
  }

  if (
    host.includes("@") ||
    host.startsWith(":") ||
    host === "[" ||
    host === "]"
  ) {
    return false;
  }

  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":", 1)[0];
  return hostname !== undefined && hostname.length > 0;
}
