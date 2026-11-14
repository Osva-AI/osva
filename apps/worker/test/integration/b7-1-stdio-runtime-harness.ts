import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConnectorVersionId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";

import { fetchJson } from "./integration-auth.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const FIXTURE_DIR = path.join(
  REPO_ROOT,
  "adapters/runtime-typescript/test/fixtures",
);

export const B7_1_STDIO_WEB_ENV = {
  OSVA_MCP_STDIO_CONNECTORS_ENABLED: "true",
  OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
} as const;

export const B7_1_STDIO_WORKER_ENV = {
  OSVA_MCP_STDIO_CONNECTORS_ENABLED: "true",
  OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
} as const;

export interface StdioMcpTransportConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly secretEnvironment?: Readonly<
    Record<string, { readonly key: string }>
  >;
}

export function buildStdioTransportConfig(
  stdioEntryAbsolutePath: string,
  environment?: Readonly<Record<string, string>>,
): StdioMcpTransportConfig {
  return {
    command: process.execPath,
    args: [path.resolve(stdioEntryAbsolutePath)],
    ...(environment !== undefined ? { environment } : {}),
  };
}

export async function ensureFakeStdioMcpBuilt(): Promise<void> {
  const distCore = path.join(
    REPO_ROOT,
    "adapters/mcp-client/dist/testing/fake-mcp-server-core.js",
  );
  try {
    await fs.access(distCore);
    return;
  } catch {
    // build below
  }
  const build = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@osva/adapters-mcp-client"],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (build.status !== 0) {
    throw new Error(
      "Failed to build @osva/adapters-mcp-client for STDIO fixtures.",
    );
  }
  await fs.access(distCore);
}

export function resolveFakeStdioMcpEntry(): string {
  return fileURLToPath(
    new URL(
      "../../../../adapters/mcp-client/test/fake-stdio-mcp-server.mjs",
      import.meta.url,
    ),
  );
}

export async function copyAgentFixtures(
  ...files: readonly string[]
): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-b7-1-runtime-"),
  );
  for (const file of files) {
    await fs.copyFile(
      path.join(FIXTURE_DIR, file),
      path.join(trustedRuntimeRoot, file),
    );
  }
  return trustedRuntimeRoot;
}

export async function agentIntegrity(
  trustedRuntimeRoot: string,
  entrypoint: string,
): Promise<string> {
  return sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, entrypoint)),
  );
}

export async function registerStdioConnectorVersion(input: {
  readonly origin: string;
  readonly connectorKey: string;
  readonly connectorName: string;
  readonly transportConfig: StdioMcpTransportConfig;
}): Promise<{
  readonly connectorId: string;
  readonly connectorVersionId: ConnectorVersionId;
}> {
  const connector = await fetchJson(`${input.origin}/v1/connectors`, {
    method: "POST",
    body: {
      key: input.connectorKey,
      name: input.connectorName,
    },
  });
  if (connector.status !== 201) {
    throw new Error(
      `connector create ${connector.status}: ${JSON.stringify(connector.body)}`,
    );
  }
  const connectorId = (connector.body as { id: string }).id;
  const version = await fetchJson(
    `${input.origin}/v1/connectors/${connectorId}/versions`,
    {
      method: "POST",
      body: {
        kind: "MCP",
        transport: "STDIO",
        transportConfig: input.transportConfig,
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `connector version ${version.status}: ${JSON.stringify(version.body)}`,
    );
  }
  return {
    connectorId,
    connectorVersionId: (version.body as { id: ConnectorVersionId }).id,
  };
}

export async function discoverMcpTools(
  origin: string,
  connectorId: string,
  connectorVersionId: ConnectorVersionId,
): Promise<ReadonlyArray<{ readonly remoteToolName: string }>> {
  const discovered = await fetchJson(
    `${origin}/v1/connectors/${connectorId}/versions/${connectorVersionId}/discover`,
    { method: "POST", body: {} },
  );
  if (discovered.status !== 200) {
    throw new Error(
      `discover ${discovered.status}: ${JSON.stringify(discovered.body)}`,
    );
  }
  const tools = (
    discovered.body as {
      tools?: ReadonlyArray<{ remoteToolName: string }>;
    }
  ).tools;
  return tools ?? [];
}

export async function importMcpTools(input: {
  readonly origin: string;
  readonly connectorVersionId: ConnectorVersionId;
  readonly tools: ReadonlyArray<{
    readonly remoteToolName: string;
    readonly toolKey: string;
    readonly toolName: string;
  }>;
}): Promise<ReadonlyArray<{ readonly toolVersionId: ToolVersionId }>> {
  const imported = await fetchJson(
    `${input.origin}/v1/connectors/import-mcp-tools`,
    {
      method: "POST",
      body: {
        connectorVersionId: input.connectorVersionId,
        tools: input.tools,
      },
    },
  );
  if (imported.status !== 200) {
    throw new Error(
      `import-mcp-tools ${imported.status}: ${JSON.stringify(imported.body)}`,
    );
  }
  return (
    imported.body as {
      imported: ReadonlyArray<{ toolVersionId: ToolVersionId }>;
    }
  ).imported;
}

export async function seedStdioFakeEchoTool(input: {
  readonly origin: string;
  readonly stdioEntry: string;
}): Promise<ToolVersionId> {
  const { connectorId, connectorVersionId } =
    await registerStdioConnectorVersion({
      origin: input.origin,
      connectorKey: "b7-1-fake-stdio",
      connectorName: "B7.1 Fake STDIO MCP",
      transportConfig: buildStdioTransportConfig(input.stdioEntry),
    });
  const discovered = await discoverMcpTools(
    input.origin,
    connectorId,
    connectorVersionId,
  );
  expectDiscoveredTool(discovered, "echo");
  const imported = await importMcpTools({
    origin: input.origin,
    connectorVersionId,
    tools: [
      {
        remoteToolName: "echo",
        toolKey: "echo",
        toolName: "Echo",
      },
    ],
  });
  return imported[0]!.toolVersionId;
}

function expectDiscoveredTool(
  tools: ReadonlyArray<{ readonly remoteToolName: string }>,
  remoteName: string,
): void {
  if (!tools.some((tool) => tool.remoteToolName === remoteName)) {
    throw new Error(
      `Expected remote tool ${remoteName}; discovered: ${tools.map((t) => t.remoteToolName).join(", ")}`,
    );
  }
}

export async function seedPublishedNpmMetadataTool(input: {
  readonly origin: string;
  readonly stdioEntry: string;
}): Promise<{
  readonly connectorVersionId: ConnectorVersionId;
  readonly toolVersionId: ToolVersionId;
}> {
  const { connectorId, connectorVersionId } =
    await registerStdioConnectorVersion({
      origin: input.origin,
      connectorKey: "b7-1-published-npm",
      connectorName: "B7.1 Published npm MCP",
      transportConfig: buildStdioTransportConfig(input.stdioEntry),
    });
  const discovered = await discoverMcpTools(
    input.origin,
    connectorId,
    connectorVersionId,
  );
  expectDiscoveredTool(discovered, "npm_package_metadata");
  const imported = await importMcpTools({
    origin: input.origin,
    connectorVersionId,
    tools: [
      {
        remoteToolName: "npm_package_metadata",
        toolKey: "npm_package_metadata",
        toolName: "npm package metadata",
      },
    ],
  });
  return {
    connectorVersionId,
    toolVersionId: imported[0]!.toolVersionId,
  };
}

export async function createTrustedTypescriptAgent(input: {
  readonly origin: string;
  readonly agentKey: string;
  readonly agentName: string;
  readonly entrypoint: string;
  readonly integrity: string;
  readonly toolBindings: Readonly<
    Record<string, { readonly toolVersionId: ToolVersionId }>
  >;
  readonly timeoutMs?: number;
}): Promise<{ readonly agentId: string; readonly agentVersionId: string }> {
  const agent = await fetchJson(`${input.origin}/v1/agents`, {
    method: "POST",
    body: {
      key: input.agentKey,
      name: input.agentName,
    },
  });
  if (agent.status !== 201) {
    throw new Error(`agent create failed: ${JSON.stringify(agent.body)}`);
  }
  const agentId = (agent.body as { id: string }).id;
  const toolBindingNames = Object.keys(input.toolBindings);
  const version = await fetchJson(
    `${input.origin}/v1/agents/${agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: input.agentKey,
          name: input.agentName,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: input.entrypoint,
            integrity: input.integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: {
            timeoutMs: input.timeoutMs ?? 60_000,
            maxAttempts: 1,
          },
          capabilities: {
            model: false,
            tools: toolBindingNames,
          },
          tools: input.toolBindings,
        },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error(`agent version failed: ${JSON.stringify(version.body)}`);
  }
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

export async function createAndAwaitRun(input: {
  readonly origin: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly runInput: unknown;
  readonly timeoutMs?: number;
}): Promise<{
  readonly runId: string;
  readonly runAttemptId: string;
  readonly terminalStatus: string;
}> {
  const created = await fetchJson(`${input.origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      input: input.runInput,
    },
  });
  if (created.status !== 201) {
    throw new Error(`run create failed: ${JSON.stringify(created.body)}`);
  }
  const runId = (created.body as { run: { id: string } }).run.id;
  const runAttemptId = (created.body as { runAttempt: { id: string } })
    .runAttempt.id;

  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  let terminalStatus = "UNKNOWN";
  while (Date.now() < deadline) {
    const run = await fetchJson(`${input.origin}/v1/runs/${runId}`);
    terminalStatus = (run.body as { status?: string }).status ?? "UNKNOWN";
    if (
      terminalStatus === "SUCCEEDED" ||
      terminalStatus === "FAILED" ||
      terminalStatus === "TIMED_OUT" ||
      terminalStatus === "CANCELLED"
    ) {
      break;
    }
    await delay(250);
  }
  return { runId, runAttemptId, terminalStatus };
}

export async function loadRunSteps(
  origin: string,
  runId: string,
  runAttemptId: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const steps = await fetchJson(
    `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
  );
  if (steps.status !== 200) {
    throw new Error(`run steps ${steps.status}: ${JSON.stringify(steps.body)}`);
  }
  return (steps.body as { steps: ReadonlyArray<Record<string, unknown>> })
    .steps;
}

export function assertToolRunStep(input: {
  readonly steps: ReadonlyArray<Record<string, unknown>>;
  readonly toolVersionId: ToolVersionId;
  readonly bindingName: string;
  readonly status?: string;
}): Record<string, unknown> {
  const toolStep = input.steps.find(
    (step) =>
      step.kind === "TOOL" &&
      step.bindingName === input.bindingName &&
      step.toolVersionId === input.toolVersionId,
  );
  if (toolStep === undefined) {
    throw new Error(
      `Expected TOOL RunStep for binding ${input.bindingName} and toolVersionId ${input.toolVersionId}. Steps: ${JSON.stringify(input.steps)}`,
    );
  }
  if (input.status !== undefined && toolStep.status !== input.status) {
    throw new Error(
      `Expected TOOL step status ${input.status}, got ${String(toolStep.status)}`,
    );
  }
  return toolStep;
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPublishedArtifactLaneEnabled(): boolean {
  return (
    process.env.OSVA_B7_1_PUBLISHED_ARTIFACT_LANE === "1" &&
    typeof process.env.OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY === "string" &&
    process.env.OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY.trim().length > 0
  );
}

export function readPublishedStdioEntry(): string {
  const entry = process.env.OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  if (entry.length === 0) {
    throw new Error(
      "OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY is required for the published artifact lane.",
    );
  }
  return path.resolve(entry);
}

export const B7_1_FIXTURE_WORKSPACE = "ws-b7-1-stdio" as WorkspaceId;
