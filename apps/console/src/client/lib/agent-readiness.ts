import type { AgentVersionResource } from "../hooks/use-agents";
import {
  readAgentRuntimeView,
  readManifestCapabilities,
} from "./agent-manifest-view";

export type ReadinessState =
  "verified_ready" | "requires_setup" | "not_verified";

export interface ReadinessItem {
  readonly id: string;
  readonly label: string;
  readonly state: ReadinessState;
  readonly detail: string;
}

export function buildRuntimeReadiness(input: {
  readonly controlPlaneReachable: boolean;
  readonly selectedVersion?: AgentVersionResource;
}): readonly ReadinessItem[] {
  const runtime = readAgentRuntimeView(input.selectedVersion?.manifest);
  const capabilities = readManifestCapabilities(
    input.selectedVersion?.manifest,
  );

  const items: ReadinessItem[] = [
    {
      id: "control-plane",
      label: "Control plane API",
      state: input.controlPlaneReachable ? "verified_ready" : "not_verified",
      detail: input.controlPlaneReachable
        ? "Console authenticated against /v1/auth/context. This does not prove PostgreSQL, Valkey, or a worker is healthy."
        : "Console has not loaded auth context, so control-plane reachability is not verified.",
    },
    {
      id: "postgres",
      label: "PostgreSQL",
      state: "not_verified",
      detail:
        "Lifecycle state lives in PostgreSQL. Console has no reliable database signal and does not infer health from API success.",
    },
    {
      id: "queue",
      label: "Valkey / queue",
      state: "not_verified",
      detail:
        "BullMQ is transport only. Console cannot verify queue connectivity from the browser.",
    },
    {
      id: "worker",
      label: "Execution worker",
      state: "not_verified",
      detail:
        "A responding Console API is not evidence that apps/worker is running or consuming RunAttempt jobs.",
    },
    {
      id: "agent-version",
      label: "Registered AgentVersion",
      state:
        input.selectedVersion === undefined
          ? "requires_setup"
          : "verified_ready",
      detail:
        input.selectedVersion === undefined
          ? "Register an Agent and append an immutable AgentVersion before launching a Run."
          : `AgentVersion ${input.selectedVersion.id} (v${String(input.selectedVersion.version)}) is loaded from the control plane.`,
    },
    {
      id: "runtime-adapter",
      label: "Runtime adapter",
      state: "not_verified",
      detail: runtimeAdapterDetail(runtime.type, runtime.details),
    },
    {
      id: "model-provider",
      label: "Model bindings",
      state: capabilities.model ? "requires_setup" : "not_verified",
      detail: capabilities.model
        ? "This version declares model capability. Configure provider connections and model profile versions on the Models page; declarative execution resolves bindings through ModelGateway at run time."
        : "This version does not declare model capability.",
    },
    {
      id: "tools",
      label: "Tool / MCP dependencies",
      state: capabilities.tools.length > 0 ? "requires_setup" : "not_verified",
      detail:
        capabilities.tools.length > 0
          ? `This version lists tool bindings (${capabilities.tools.join(", ")}). Bindings are frozen at Run creation; Console cannot verify tool runtime health.`
          : "This version lists no tool bindings. MCP and tools still sit beneath ToolGateway if added later.",
    },
  ];

  return items;
}

export function readinessLabel(state: ReadinessState): string {
  switch (state) {
    case "verified_ready":
      return "Verified ready";
    case "requires_setup":
      return "Requires setup";
    case "not_verified":
      return "Not verified";
  }
}

function runtimeAdapterDetail(
  type: string,
  details: Readonly<Record<string, string>>,
): string {
  switch (type) {
    case "TRUSTED_TYPESCRIPT": {
      const entrypoint = details.entrypoint ?? "the declared entrypoint";
      return `Runtime type is TRUSTED_TYPESCRIPT. Place ${entrypoint} under OSVA_TRUSTED_RUNTIME_ROOT on the worker and set runtime.integrity to sha256 of those bytes. Console cannot verify the file exists.`;
    }
    case "CONTAINER":
      return "Runtime type is CONTAINER. A digest-pinned image in the manifest is not evidence the image exists or is executable on the worker host.";
    case "REMOTE_HTTP":
      return "Runtime type is REMOTE_HTTP. Console cannot verify that the remote endpoint is reachable.";
    case "BUILTIN_PACKAGE":
      return "Runtime type is BUILTIN_PACKAGE. Production workers typically have no executor for this type; Runs fail at execution, not at create time.";
    case "DECLARATIVE":
      return "Runtime type is DECLARATIVE. Execution uses the in-process declarative runtime (ModelGateway and ToolGateway).";
    default:
      return "Console cannot verify that a runtime adapter is registered on the worker.";
  }
}
