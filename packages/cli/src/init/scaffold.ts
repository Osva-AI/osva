import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderTemplateString } from "./template-vars.js";
import { resolveAgentTemplateRoot } from "./template-root.js";
import type { InitTemplateVars } from "./types.js";

async function assertTargetAvailable(targetDir: string): Promise<void> {
  try {
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Refusing to overwrite existing directory: ${targetDir}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function collectTemplateFiles(
  templateRoot: string,
  relativeDir = "",
): Promise<readonly string[]> {
  const absoluteDir = path.join(templateRoot, relativeDir);
  const names = await readdir(absoluteDir);
  const files: string[] = [];
  for (const name of names) {
    const relativePath =
      relativeDir.length === 0 ? name : `${relativeDir}/${name}`;
    const absolutePath = path.join(templateRoot, relativePath);
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      files.push(...(await collectTemplateFiles(templateRoot, relativePath)));
      continue;
    }
    files.push(relativePath.replace(/\\/g, "/"));
  }
  return files;
}

function mapTemplateOutputPath(
  relativePath: string,
  vars: InitTemplateVars,
): string {
  if (relativePath === "agent/agent.ts.template") {
    return `agent/${vars.entrypoint.replace(/\.js$/, ".ts")}`;
  }
  if (relativePath.endsWith(".template")) {
    return relativePath.slice(0, -".template".length);
  }
  return relativePath;
}

export async function scaffoldAgentProject(input: {
  readonly targetDir: string;
  readonly vars: InitTemplateVars;
}): Promise<readonly string[]> {
  await assertTargetAvailable(input.targetDir);
  await mkdir(input.targetDir, { recursive: true });

  const templateRoot = resolveAgentTemplateRoot();
  const templateFiles = await collectTemplateFiles(templateRoot);
  const written: string[] = [];

  for (const relativePath of templateFiles) {
    const sourcePath = path.join(templateRoot, relativePath);
    const outputRelative = mapTemplateOutputPath(relativePath, input.vars);
    const outputPath = path.join(input.targetDir, outputRelative);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const raw = await readFile(sourcePath, "utf8");
    const contents = relativePath.endsWith(".template")
      ? renderTemplateString(raw, input.vars)
      : raw;
    await writeFile(outputPath, contents, { encoding: "utf8", flag: "wx" });
    written.push(outputRelative.replace(/\\/g, "/"));
  }

  return written.sort();
}
