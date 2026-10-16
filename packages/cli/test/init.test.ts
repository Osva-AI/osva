import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentManifestSchema } from "@osva-ai/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentTemplateRoot } from "../src/init/template-root.js";
import { runInit } from "../src/init/run-init.js";
import { validateProjectName } from "../src/init/validate-project-name.js";
import {
  removeTempDir,
  runCliSubprocess,
} from "./helpers/run-cli-subprocess.js";

const CLI_PACKAGE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const execFileAsync = promisify(execFile);

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => removeTempDir(dir)));
});

async function makeTempRoot(label = "osva-init"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
  tempRoots.push(dir);
  return dir;
}

function runNpm(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("osva init", () => {
  it("bundled template root exists beside dist output", () => {
    const root = resolveAgentTemplateRoot();
    expect(root).toContain(`${path.sep}templates${path.sep}agent-typescript`);
  });

  it("scaffolds a standard project tree", async () => {
    const cwd = await makeTempRoot();
    const result = await runInit({ projectName: "my-first-agent", cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toEqual(
      expect.arrayContaining([
        ".gitignore",
        "README.md",
        "package.json",
        "tsconfig.json",
        "osva-agent.project.json",
        "contracts/input.v1.schema.json",
        "contracts/output.v1.schema.json",
        "scripts/build-manifest.mjs",
        "agent/my-first-agent.ts",
      ]),
    );
    const packageJson = JSON.parse(
      await readFile(path.join(result.projectDir, "package.json"), "utf8"),
    ) as { name: string; dependencies?: unknown };
    expect(packageJson.name).toBe("my-first-agent");
    expect(packageJson.dependencies).toBeUndefined();
    const projectConfig = JSON.parse(
      await readFile(
        path.join(result.projectDir, "osva-agent.project.json"),
        "utf8",
      ),
    ) as { runtime: { entrypoint: string } };
    expect(projectConfig.runtime.entrypoint).toBe("my-first-agent.js");
  });

  it("supports --json and --yes via CLI without credentials", async () => {
    const cwd = await makeTempRoot();
    const result = await runCliSubprocess(
      ["init", "demo-agent", "--yes", "--json"],
      {
        cwd,
        env: { OSVA_API_KEY: "", OSVA_BASE_URL: "" },
      },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      projectName: string;
      files: string[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.projectName).toBe("demo-agent");
    expect(payload.files.length).toBeGreaterThan(0);
  });

  it("rejects invalid project names", async () => {
    expect(() => validateProjectName("Bad_Name")).toThrow(/lowercase/);
    expect(() => validateProjectName("../escape")).toThrow(/path/);
    const cwd = await makeTempRoot();
    const result = await runInit({ projectName: "UPPER", cwd });
    expect(result.ok).toBe(false);
  });

  it("refuses existing nonempty directories", async () => {
    const cwd = await makeTempRoot();
    const projectDir = path.join(cwd, "occupied");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "keep.txt"), "stay", "utf8");
    const result = await runInit({ projectName: "occupied", cwd });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatch(/Refusing to overwrite/);
  });

  it("refuses repeated init into the same directory", async () => {
    const cwd = await makeTempRoot();
    const first = await runInit({ projectName: "repeat-agent", cwd });
    expect(first.ok).toBe(true);
    const second = await runInit({ projectName: "repeat-agent", cwd });
    expect(second.ok).toBe(false);
  });

  it("works when the working directory path contains spaces", async () => {
    const parent = await makeTempRoot("osva init space");
    const cwd = path.join(parent, "work dir");
    await mkdir(cwd, { recursive: true });
    const result = await runInit({ projectName: "space-agent", cwd });
    expect(result.ok).toBe(true);
  });

  it("does not write credentials into generated files", async () => {
    const cwd = await makeTempRoot();
    const result = await runInit({ projectName: "secret-free", cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const files = await listFilesRecursive(result.projectDir);
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      expect(contents).not.toMatch(/osva_ak_/);
      if (process.env.USERPROFILE) {
        expect(contents).not.toContain(process.env.USERPROFILE);
      }
      if (process.env.HOME) {
        expect(contents).not.toContain(process.env.HOME);
      }
    }
  });

  it("generated TypeScript builds and produces a valid manifest", async () => {
    const cwd = await makeTempRoot();
    const result = await runInit({ projectName: "buildable-agent", cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const install = await runNpm(
      ["install", "--no-fund", "--no-audit"],
      result.projectDir,
    );
    expect(install.code).toBe(0);

    const build = await runNpm(["run", "build"], result.projectDir);
    expect(build.code).toBe(0);

    const manifestRun = await runNpm(["run", "manifest"], result.projectDir);
    expect(manifestRun.code).toBe(0);

    const manifest = JSON.parse(
      await readFile(
        path.join(result.projectDir, "osva.manifest.json"),
        "utf8",
      ),
    );
    const parsed = agentManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.runtime.type).toBe("TRUSTED_TYPESCRIPT");
      if (parsed.data.runtime.type === "TRUSTED_TYPESCRIPT") {
        expect(parsed.data.runtime.entrypoint).toBe("buildable-agent.js");
      }
    }
  }, 120_000);

  it("npm pack includes template assets", async () => {
    const pack = await runNpm(["pack", "--silent"], CLI_PACKAGE_DIR);
    expect(pack.code).toBe(0);
    const tarball = pack.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarball).toBeDefined();
    if (tarball === undefined) {
      return;
    }
    const tarballPath = path.join(CLI_PACKAGE_DIR, tarball);
    tempRoots.push(tarballPath);

    const list = await execFileAsync("tar", ["-tf", tarballPath], {
      cwd: CLI_PACKAGE_DIR,
      encoding: "utf8",
    });
    expect(list.stdout).toContain(
      "package/templates/agent-typescript/package.json.template",
    );
    expect(list.stdout).toContain(
      "package/templates/agent-typescript/scripts/build-manifest.mjs",
    );
  }, 60_000);
});

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolute)));
      continue;
    }
    files.push(absolute);
  }
  return files;
}
