export const OSVA_EXECUTION_ID_ENV = "OSVA_EXECUTION_ID" as const;
export const OSVA_RUNTIME_BOOTSTRAP_URL_ENV =
  "OSVA_RUNTIME_BOOTSTRAP_URL" as const;
export const OSVA_RUNTIME_BOOTSTRAP_TOKEN_ENV =
  "OSVA_RUNTIME_BOOTSTRAP_TOKEN" as const;

export interface ContainerExecutionBootstrapEnv {
  readonly executionId: string;
  readonly bootstrapUrl: string;
  readonly bootstrapToken: string;
}

export function formatContainerBootstrapEnv(
  bootstrap: ContainerExecutionBootstrapEnv,
): readonly string[] {
  return [
    `${OSVA_EXECUTION_ID_ENV}=${bootstrap.executionId}`,
    `${OSVA_RUNTIME_BOOTSTRAP_URL_ENV}=${bootstrap.bootstrapUrl}`,
    `${OSVA_RUNTIME_BOOTSTRAP_TOKEN_ENV}=${bootstrap.bootstrapToken}`,
  ];
}
