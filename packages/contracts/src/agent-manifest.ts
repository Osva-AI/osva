import type {
  MemoryNamespaceId,
  ModelProfileVersionId,
  ToolVersionId,
} from "./ids.js";
import type { MemoryAccessMode } from "./memory-gateway.js";
import type { JsonSchemaRecord } from "./json-schema.js";
import type { SecretReference } from "./secret-reference.js";

export const AGENT_MANIFEST_SCHEMA_VERSION = "1" as const;

export type AgentManifestSchemaVersion = typeof AGENT_MANIFEST_SCHEMA_VERSION;

export const AGENT_RUNTIME_TYPES = [
  "BUILTIN_PACKAGE",
  "TRUSTED_TYPESCRIPT",
  "REMOTE_HTTP",
] as const;

export const AGENT_REMOTE_HTTP_PROTOCOL_VERSION = "1" as const;

export type AgentRemoteHttpProtocolVersion =
  typeof AGENT_REMOTE_HTTP_PROTOCOL_VERSION;

export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];

export const AGENT_EXECUTION_MIN_TIMEOUT_MS = 100;
export const AGENT_EXECUTION_MAX_TIMEOUT_MS = 300_000;
export const AGENT_EXECUTION_DEFAULT_TIMEOUT_MS = 30_000;

export interface BuiltinPackageRuntime {
  readonly type: "BUILTIN_PACKAGE";
  /**
   * Identifies a registered runtime package. It does not authorize
   * arbitrary imports.
   */
  readonly key: string;
}

export interface TrustedTypeScriptRuntime {
  readonly type: "TRUSTED_TYPESCRIPT";
  /**
   * Relative POSIX path beneath OSVA_TRUSTED_RUNTIME_ROOT.
   * Absolute paths, traversal, inline source, and package installs are rejected.
   */
  readonly entrypoint: string;
  /**
   * SHA-256 digest of the entrypoint artifact, formatted `sha256:<hex>`.
   */
  readonly integrity: string;
}

export interface RemoteHttpRuntime {
  readonly type: "REMOTE_HTTP";
  /**
   * Runtime Protocol version understood by the remote endpoint.
   * Slice 2.4 supports `"1"` only.
   */
  readonly protocolVersion: AgentRemoteHttpProtocolVersion;
  /**
   * Privileged `http:` / `https:` execute URL owned by this AgentVersion.
   * Never taken from Run or workflow input.
   */
  readonly endpoint: string;
  /**
   * Optional secret reference for the outbound execute Authorization header.
   * Plaintext remote credentials are rejected.
   */
  readonly authSecretRef?: SecretReference;
  /**
   * Optional execute timeout. Defaults to `execution.timeoutMs` when omitted.
   */
  readonly timeoutMs?: number;
}

export type AgentRuntime =
  BuiltinPackageRuntime | TrustedTypeScriptRuntime | RemoteHttpRuntime;

export interface AgentManifestIO {
  readonly schema: JsonSchemaRecord;
}

export interface AgentManifestExecution {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
}

export interface AgentManifestCapabilities {
  readonly model: boolean;
  readonly tools: readonly string[];
}

export interface AgentManifestModelBinding {
  readonly modelProfileVersionId: ModelProfileVersionId;
}

export interface AgentManifestToolBinding {
  readonly toolVersionId: ToolVersionId;
}

export interface AgentManifestMemoryBinding {
  readonly namespaceId: MemoryNamespaceId;
  readonly access: MemoryAccessMode;
}

/**
 * Executable contract of an AgentVersion.
 * The document has no plaintext-secret field; secret values are SecretReferences elsewhere.
 */
export interface AgentManifestV1 {
  readonly schemaVersion: AgentManifestSchemaVersion;
  readonly key: string;
  readonly name: string;
  readonly runtime: AgentRuntime;
  readonly input: AgentManifestIO;
  readonly output: AgentManifestIO;
  readonly execution: AgentManifestExecution;
  readonly capabilities: AgentManifestCapabilities;
  /**
   * Optional logical model bindings. Absent or empty maps freeze as `{}`
   * on CreateRun. Binding names are identifiers, not provider model IDs.
   */
  readonly models?: Readonly<Record<string, AgentManifestModelBinding>>;
  /**
   * Optional logical tool bindings. Absent or empty maps freeze as `{}`
   * on CreateRun. Binding names are identifiers, not implementation IDs.
   */
  readonly tools?: Readonly<Record<string, AgentManifestToolBinding>>;
  /**
   * Optional logical memory bindings. Absent or empty maps freeze as `{}`
   * on CreateRun. Binding names are identifiers, not namespace database IDs.
   */
  readonly memory?: Readonly<Record<string, AgentManifestMemoryBinding>>;
}
