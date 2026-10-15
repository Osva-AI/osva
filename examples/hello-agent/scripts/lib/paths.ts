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

export const packageRootDir = resolvePackageRoot(scriptsLibDir);

export const HELLO_AGENT_ENTRYPOINT = "hello-agent.js";

export const agentSourcePath = path.join(
  packageRootDir,
  "agent",
  "hello-agent.ts",
);

export const agentArtifactPath = path.join(
  packageRootDir,
  "dist",
  "agent",
  HELLO_AGENT_ENTRYPOINT,
);

export const contractsDir = path.join(packageRootDir, "contracts");

export function requiredAgentBuildArtifacts(): readonly string[] {
  return [agentArtifactPath];
}
