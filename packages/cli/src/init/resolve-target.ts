import path from "node:path";

import { validateProjectName } from "./validate-project-name.js";

export function resolveInitTargetDir(cwd: string, projectName: string): string {
  validateProjectName(projectName);
  const normalizedCwd = path.resolve(cwd);
  const targetDir = path.resolve(normalizedCwd, projectName);
  const relative = path.relative(normalizedCwd, targetDir);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Project directory must stay within the current working directory.",
    );
  }
  return targetDir;
}
