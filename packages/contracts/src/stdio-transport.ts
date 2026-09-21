import type { StdioTransportConfig } from "./connector.js";

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidProcessEnvironmentVariableName(name: string): boolean {
  return ENV_VAR_NAME_PATTERN.test(name);
}

export function listStdioEnvironmentConflicts(
  config: Pick<StdioTransportConfig, "environment" | "secretEnvironment">,
): readonly string[] {
  const plain = config.environment ?? {};
  const secret = config.secretEnvironment ?? {};
  return Object.keys(secret).filter((key) => key in plain);
}

export function validateStdioTransportEnvironment(
  config: Pick<StdioTransportConfig, "environment" | "secretEnvironment">,
): void {
  const names = [
    ...Object.keys(config.environment ?? {}),
    ...Object.keys(config.secretEnvironment ?? {}),
  ];
  for (const name of names) {
    if (!isValidProcessEnvironmentVariableName(name)) {
      throw new Error(
        `Invalid process environment variable name '${name}' in stdio transport configuration.`,
      );
    }
  }

  const conflicts = listStdioEnvironmentConflicts(config);
  if (conflicts.length > 0) {
    throw new Error(
      `Stdio transport environment and secretEnvironment both define: ${conflicts.join(", ")}.`,
    );
  }
}
