import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  distAgentsDir,
  distMcpStdioEntry,
  packageRoot,
  requiredAgentBuildArtifacts,
  trustedRuntimeBundleDir,
  trustedRuntimeEntrypointPosix,
} from "./paths.js";
import { sha256IntegrityOfFile } from "./integrity.js";

export class SetupDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupDeployError";
  }
}

export async function runPackageBuild(): Promise<void> {
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new SetupDeployError("Canonical example package build failed.");
  }
}

export async function assertBuildArtifactsExist(): Promise<void> {
  for (const artifactPath of requiredAgentBuildArtifacts()) {
    await access(artifactPath);
  }
}

export interface DeployedTrustedRuntime {
  readonly bundleDir: string;
  readonly researchEntrypoint: string;
  readonly analysisEntrypoint: string;
  readonly reportEntrypoint: string;
  readonly researchIntegrity: string;
  readonly analysisIntegrity: string;
  readonly reportIntegrity: string;
  readonly mcpStdioEntry: string;
}

export async function deployTrustedRuntimeAndMcp(
  trustedRuntimeRoot: string,
  options?: { readonly mcpStdioEntry?: string },
): Promise<DeployedTrustedRuntime> {
  await assertBuildArtifactsExist();

  const bundleDir = trustedRuntimeBundleDir(trustedRuntimeRoot);
  await mkdir(bundleDir, { recursive: true });
  await cp(distAgentsDir, bundleDir, { recursive: true, force: true });

  const researchFile = path.join(bundleDir, "research-agent.js");
  const analysisFile = path.join(bundleDir, "analysis-agent.js");
  const reportFile = path.join(bundleDir, "report-agent.js");

  await verifyEntrypointImports(researchFile);
  await verifyEntrypointImports(analysisFile);
  await verifyEntrypointImports(reportFile);

  return {
    bundleDir,
    researchEntrypoint: trustedRuntimeEntrypointPosix("research-agent.js"),
    analysisEntrypoint: trustedRuntimeEntrypointPosix("analysis-agent.js"),
    reportEntrypoint: trustedRuntimeEntrypointPosix("report-agent.js"),
    researchIntegrity: await sha256IntegrityOfFile(researchFile),
    analysisIntegrity: await sha256IntegrityOfFile(analysisFile),
    reportIntegrity: await sha256IntegrityOfFile(reportFile),
    mcpStdioEntry: path.resolve(options?.mcpStdioEntry ?? distMcpStdioEntry),
  };
}

async function verifyEntrypointImports(entrypointFile: string): Promise<void> {
  await import(pathToFileURL(entrypointFile).href);
}

export function buildStdioMcpTransportConfig(stdioEntryAbsolutePath: string): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return {
    command: process.execPath,
    args: [path.resolve(stdioEntryAbsolutePath)],
  };
}

export async function readPolicyDocumentBytes(): Promise<Buffer> {
  return readFile(
    path.join(
      packageRoot,
      "knowledge",
      "engineering-dependency-adoption-policy.md",
    ),
  );
}
