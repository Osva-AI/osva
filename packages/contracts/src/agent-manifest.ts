import type { JsonSchemaRecord } from "./json-schema.js";

export const AGENT_MANIFEST_SCHEMA_VERSION = "1" as const;

export type AgentManifestSchemaVersion = typeof AGENT_MANIFEST_SCHEMA_VERSION;

export const AGENT_RUNTIME_TYPES = ["BUILTIN_PACKAGE"] as const;

export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];

export interface AgentRuntime {
  readonly type: AgentRuntimeType;
  /**
   * Identifies a registered runtime package. It does not authorize
   * arbitrary imports.
   */
  readonly key: string;
}

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
}
