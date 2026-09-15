import type { ModelProfileVersionId } from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";

export const AGENT_MANIFEST_SCHEMA_VERSION = "1" as const;

export type AgentManifestSchemaVersion = typeof AGENT_MANIFEST_SCHEMA_VERSION;

export const AGENT_RUNTIME_TYPES = [
  "BUILTIN_PACKAGE",
  "TRUSTED_TYPESCRIPT",
] as const;

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

export type AgentRuntime = BuiltinPackageRuntime | TrustedTypeScriptRuntime;

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
}
