import path from "node:path";

import { resolveInitTargetDir } from "./resolve-target.js";
import { scaffoldAgentProject } from "./scaffold.js";
import { buildTemplateVars } from "./template-vars.js";
import type { InitResult } from "./types.js";
import { validateProjectName } from "./validate-project-name.js";

export async function runInit(input: {
  readonly projectName: string | undefined;
  readonly cwd?: string;
}): Promise<InitResult> {
  const projectName = input.projectName?.trim();
  if (projectName === undefined || projectName.length === 0) {
    return {
      ok: false,
      error: "Usage: osva init <project-name> [--yes] [--json]",
    };
  }

  try {
    validateProjectName(projectName);
    const cwd = input.cwd ?? process.cwd();
    const targetDir = resolveInitTargetDir(cwd, projectName);
    const vars = buildTemplateVars(projectName);
    const files = await scaffoldAgentProject({ targetDir, vars });
    return {
      ok: true,
      projectName,
      projectDir: path.resolve(targetDir),
      files,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Init failed.",
    };
  }
}
