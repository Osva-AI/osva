export const OSVA_CONTAINER_MANAGED_LABEL = "osva.managed" as const;
export const OSVA_CONTAINER_EXECUTION_ID_LABEL = "osva.execution.id" as const;

export function osvaContainerLabels(
  executionId: string,
): Readonly<Record<string, string>> {
  return {
    [OSVA_CONTAINER_MANAGED_LABEL]: "true",
    [OSVA_CONTAINER_EXECUTION_ID_LABEL]: executionId,
  };
}
