import type {
  AgentId,
  ConnectorVersionId,
  RunAttemptId,
  RunId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { ResolveExternalConnectorStdioEntryOptions } from "./resolve-external-connector-stdio-entry.js";

export const DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS = 60_000;

export type ConnectorCompatibilityExecutionMode = "required" | "optional";

export interface McpConnectorToolImportSpec {
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly toolName: string;
  readonly bindingName: string;
}

export interface McpConnectorSecretSpec {
  readonly secretRefKey: string;
  readonly validSecretValue: string;
  readonly invalidSecretValue?: string;
  readonly secretEnvironment: Readonly<
    Record<string, { readonly key: string }>
  >;
}

export interface McpConnectorCompatibilityFixtureContext {
  readonly apiBaseUrl: string;
  readonly leakedCredentialMarker: string;
  readonly leakedDebugMarker: string;
  setProviderMode(
    mode: "success" | "unauthorized" | "server_error" | "slow",
  ): void;
  getProviderRequestCount(): number;
  close?(): Promise<void>;
  getLastAuthorization?(): string | undefined;
}

export interface McpConnectorCompatibilityCase {
  readonly id: string;
  readonly connectorLabel: string;
  readonly connectorKey: string;
  readonly connectorDisplayName: string;
  readonly executionMode: ConnectorCompatibilityExecutionMode;
  readonly stdioEntryResolution: ResolveExternalConnectorStdioEntryOptions;
  readonly requireIntegrationEnvVars: readonly string[];
  readonly buildInstructions: readonly string[];
  readonly toolImport: McpConnectorToolImportSpec;
  readonly secrets: McpConnectorSecretSpec;
  readonly workspaceIds: {
    readonly primary: WorkspaceId;
    readonly secondary: WorkspaceId;
  };
  readonly agentId: AgentId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  fixtureEnvironment(
    context: McpConnectorCompatibilityFixtureContext,
  ): Readonly<Record<string, string>>;
  startFixture(): Promise<McpConnectorCompatibilityFixtureContext>;
  readonly happyPathInput: unknown;
  assertHappyPathOutput(
    output: unknown,
    context: McpConnectorCompatibilityFixtureContext,
  ): void;
  assertHappyPathSideEffects?(
    context: McpConnectorCompatibilityFixtureContext,
  ): void;
  assertInvalidCredentialsError?(error: unknown): void;
  readonly cancellationSlowDelayMs?: number;
}

export interface RegisteredConnectorImport {
  readonly toolVersionId: ToolVersionId;
  readonly connectorVersionId: ConnectorVersionId;
  readonly createdNewToolVersion: boolean;
  readonly remoteToolName: string;
}
