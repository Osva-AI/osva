import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentManifestV1 } from "@osva-ai/contracts";
import { agentManifestSchema } from "@osva-ai/contracts/schemas";

export async function loadProjectManifest(
  projectDir: string,
): Promise<AgentManifestV1> {
  const manifestPath = path.join(projectDir, "osva.manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = agentManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error("osva.manifest.json is invalid.");
  }
  return parsed.data as AgentManifestV1;
}
