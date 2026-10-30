/** Long-running OSVA application services (excludes one-shot migrate/bootstrap jobs). */
export const PLATFORM_APPLICATION_SERVICES = [
  "web",
  "worker",
  "scheduler",
  "workflow-orchestrator",
  "knowledge-worker",
  "mcp-server",
  "console",
] as const;

export const PLATFORM_DATA_SERVICES = ["postgres", "valkey"] as const;

export const PLATFORM_LIFECYCLE_SERVICES = [
  ...PLATFORM_DATA_SERVICES,
  ...PLATFORM_APPLICATION_SERVICES,
] as const;

export type PlatformServiceName =
  | (typeof PLATFORM_DATA_SERVICES)[number]
  | (typeof PLATFORM_APPLICATION_SERVICES)[number]
  | "migrate";

export const KNOWN_COMPOSE_SERVICES: readonly PlatformServiceName[] = [
  ...PLATFORM_DATA_SERVICES,
  "migrate",
  ...PLATFORM_APPLICATION_SERVICES,
];
