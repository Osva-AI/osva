import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsLibDir = path.dirname(fileURLToPath(import.meta.url));

/** Compiled setup lives under `dist/scripts/lib`; source lives under `scripts/lib`. */
export function resolvePackageRoot(scriptsLibDirectory: string): string {
  const normalized = scriptsLibDirectory.replace(/\\/g, "/");
  if (normalized.includes("/dist/scripts/lib")) {
    return path.resolve(scriptsLibDirectory, "../../..");
  }
  return path.resolve(scriptsLibDirectory, "../..");
}

export const packageRoot = resolvePackageRoot(scriptsLibDir);

export const policyDocumentPath = path.join(
  packageRoot,
  "knowledge",
  "engineering-dependency-adoption-policy.md",
);

export const workflowReferencePath = path.join(
  packageRoot,
  "workflow",
  "dependency-adoption.v3.json",
);

export const contractSchemaPaths = {
  workflowInput: path.join(
    packageRoot,
    "contracts",
    "workflow-input.v1.schema.json",
  ),
  researchOutput: path.join(
    packageRoot,
    "contracts",
    "research-output.v1.schema.json",
  ),
  analysisOutput: path.join(
    packageRoot,
    "contracts",
    "analysis-output.v1.schema.json",
  ),
  reportOutput: path.join(
    packageRoot,
    "contracts",
    "report-output.v1.schema.json",
  ),
} as const;

export const distAgentsDir = path.join(packageRoot, "dist", "agents");
export const distMcpStdioEntry = path.join(
  packageRoot,
  "dist",
  "mcp",
  "npm-connector",
  "stdio.js",
);

export const distMcpStdioDeterministicEntry = path.join(
  packageRoot,
  "dist",
  "mcp",
  "npm-connector",
  "stdio-deterministic.js",
);

export const trustedRuntimeBundleDirName = "canonical-dependency-adoption";

export function trustedRuntimeBundleDir(trustedRuntimeRoot: string): string {
  return path.join(trustedRuntimeRoot, trustedRuntimeBundleDirName);
}

export function trustedRuntimeEntrypointPosix(fileName: string): string {
  return `${trustedRuntimeBundleDirName}/${fileName}`.replace(/\\/g, "/");
}

export function stateFilePath(): string {
  return path.join(packageRoot, ".osva", "canonical-state.json");
}

export function requiredAgentBuildArtifacts(): readonly string[] {
  return [
    path.join(distAgentsDir, "research-agent.js"),
    path.join(distAgentsDir, "analysis-agent.js"),
    path.join(distAgentsDir, "report-agent.js"),
    path.join(distAgentsDir, "shared"),
    distMcpStdioEntry,
    distMcpStdioDeterministicEntry,
  ];
}
