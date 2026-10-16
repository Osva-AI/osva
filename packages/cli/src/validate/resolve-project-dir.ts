import { stat } from "node:fs/promises";
import path from "node:path";

export async function resolveValidateProjectDir(input: {
  readonly cwd: string;
  readonly flags: Readonly<Record<string, string | boolean>>;
}): Promise<
  | { ok: true; projectDir: string }
  | { ok: false; error: string; projectDir: string }
> {
  const projectFlag = input.flags.project;
  const projectDir =
    typeof projectFlag === "string" && projectFlag.length > 0
      ? path.resolve(input.cwd, projectFlag)
      : path.resolve(input.cwd);

  try {
    const info = await stat(projectDir);
    if (!info.isDirectory()) {
      return {
        ok: false,
        projectDir,
        error: `Project path is not a directory: ${projectDir}`,
      };
    }
  } catch {
    return {
      ok: false,
      projectDir,
      error: `Project directory does not exist: ${projectDir}`,
    };
  }

  return { ok: true, projectDir };
}
