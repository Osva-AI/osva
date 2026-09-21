import type { SecretResolver, StdioTransportConfig } from "@osva/contracts";
import { validateStdioTransportEnvironment } from "@osva/contracts";

import { mcpAdapterError } from "./errors.js";

export async function resolveStdioProcessEnvironment(
  config: StdioTransportConfig,
  secretResolver: SecretResolver,
): Promise<Record<string, string>> {
  validateStdioTransportEnvironment(config);

  const merged: Record<string, string> = {
    ...(config.environment ?? {}),
  };

  const secretEnvironment = config.secretEnvironment ?? {};
  for (const [name, reference] of Object.entries(secretEnvironment)) {
    const resolved = await secretResolver.resolve(reference);
    if (resolved === undefined || resolved.length === 0) {
      throw mcpAdapterError(
        "CONNECTOR_UNAVAILABLE",
        `Unresolved secret for stdio environment variable '${name}'.`,
        true,
      );
    }
    merged[name] = resolved;
  }

  return merged;
}
