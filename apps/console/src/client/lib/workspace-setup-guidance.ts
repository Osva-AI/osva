import type { AgentResource } from "../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProviderConnectionResource,
} from "../hooks/use-models";

export type SetupGuidanceState =
  "verified_ready" | "requires_setup" | "not_verifiable";

export interface SetupGuidanceItem {
  readonly id: string;
  readonly label: string;
  readonly state: SetupGuidanceState;
  readonly detail: string;
  readonly configurePath: string;
}

export function buildWorkspaceSetupGuidance(input: {
  readonly controlPlaneReachable: boolean;
  readonly agents: readonly AgentResource[] | undefined;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly hasBoundProfileVersion?: boolean;
}): readonly SetupGuidanceItem[] {
  const agentCount = input.agents?.length ?? 0;
  const profileCount = input.modelProfiles?.length ?? 0;
  const connectionCount = input.modelConnections?.length ?? 0;
  const modelsReady =
    connectionCount > 0 &&
    profileCount > 0 &&
    input.hasBoundProfileVersion === true;

  return [
    {
      id: "control-plane",
      label: "Console session",
      state: input.controlPlaneReachable ? "verified_ready" : "not_verifiable",
      detail: input.controlPlaneReachable
        ? "Authenticated against the Console API. This does not prove PostgreSQL, Valkey, or worker health."
        : "Session or workspace context is not loaded.",
      configurePath: "/overview",
    },
    {
      id: "models",
      label: "Model profiles & connections",
      state: modelsReady ? "verified_ready" : "requires_setup",
      detail: modelsReady
        ? `${String(profileCount)} profile(s), ${String(connectionCount)} connection(s), and at least one profile version bound to a connection version.`
        : connectionCount === 0
          ? "Start on Models → Manage connections: pick a provider, append a connection version with endpoint and credential reference, then create a profile version that references it."
          : profileCount === 0
            ? "Connection registered. Create a ModelProfile, open it, and append a ModelProfileVersion linked to your connection version."
            : "Profile exists but no version is bound to a provider connection version yet. Open the profile and append a version with a connection version id.",
      configurePath: "/models",
    },
    {
      id: "agents",
      label: "Agents",
      state: agentCount > 0 ? "verified_ready" : "requires_setup",
      detail:
        agentCount > 0
          ? `${String(agentCount)} agent(s) registered. Publish an immutable AgentVersion before launching Runs.`
          : "No agents yet. Use Agent Studio for declarative agents or the developer path for trusted runtimes.",
      configurePath: "/agents/new",
    },
    {
      id: "worker",
      label: "Execution worker",
      state: "not_verifiable",
      detail:
        "Console cannot verify that apps/worker is running or consuming RunAttempt jobs from the browser.",
      configurePath: "/onboarding",
    },
  ];
}

export function setupGuidanceLabel(state: SetupGuidanceState): string {
  switch (state) {
    case "verified_ready":
      return "Verified";
    case "requires_setup":
      return "Action needed";
    case "not_verifiable":
      return "Not verifiable";
  }
}
