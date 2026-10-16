#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:m10-2e

Live end-to-end CLI developer workflow (opt-in).

Set OSVA_ACCEPTANCE_LIVE=1 and provide:
  OSVA_BASE_URL, OSVA_API_KEY
  OSVA_TRUSTED_RUNTIME_MODE=compose + OSVA_COMPOSE_DIR
    or host + OSVA_TRUSTED_RUNTIME_ROOT

Optional: OSVA_WORKSPACE_ID, OSVA_CLI_PATH
`);
}

function runNode(args, options) {
  return spawnSync(process.execPath, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  if (process.env.OSVA_ACCEPTANCE_LIVE !== "1") {
    console.error(
      "Refusing to run live acceptance without OSVA_ACCEPTANCE_LIVE=1.",
    );
    printHelp();
    process.exit(1);
  }

  requireEnv("OSVA_BASE_URL");
  requireEnv("OSVA_API_KEY");

  const buildCli = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@osva-ai/cli..."],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (buildCli.status !== 0) {
    process.exit(buildCli.status ?? 1);
  }

  const cliBin =
    process.env.OSVA_CLI_PATH?.trim() ??
    path.join(REPO_ROOT, "packages", "cli", "dist", "bin", "osva.js");

  const workRoot = await mkdtemp(path.join(os.tmpdir(), "osva-m102e-live-"));
  const projectName = "acceptance-agent";

  try {
    const init = runNode([cliBin, "init", projectName, "--yes"], {
      cwd: workRoot,
      env: { ...process.env, OSVA_API_KEY: process.env.OSVA_API_KEY },
    });
    if (init.status !== 0) {
      throw new Error(`init failed: ${init.stderr}`);
    }

    const projectDir = path.join(workRoot, projectName);
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    for (const args of [
      ["install", "--no-fund", "--no-audit"],
      ["run", "build"],
      ["run", "manifest"],
    ]) {
      const step = spawnSync(npmCmd, args, {
        cwd: projectDir,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (step.status !== 0) {
        throw new Error(`npm ${args.join(" ")} failed`);
      }
    }

    const validate = runNode([cliBin, "validate", "--json"], {
      cwd: projectDir,
    });
    if (validate.status !== 0) {
      throw new Error(`validate failed: ${validate.stderr}`);
    }
    const validateReport = JSON.parse(validate.stdout);
    if (validateReport.result !== "pass") {
      throw new Error("validate did not pass");
    }

    const deploy1 = runNode([cliBin, "deploy", "--json"], { cwd: projectDir });
    if (deploy1.status !== 0) {
      throw new Error(`deploy failed: ${deploy1.stderr}`);
    }
    const deploy1Body = JSON.parse(deploy1.stdout);
    const versionId1 = deploy1Body.agentVersionId;

    const deploy2 = runNode([cliBin, "deploy", "--json"], { cwd: projectDir });
    if (deploy2.status !== 0) {
      throw new Error(`second deploy failed: ${deploy2.stderr}`);
    }
    const deploy2Body = JSON.parse(deploy2.stdout);
    if (deploy2Body.reusedAgentVersion !== true) {
      throw new Error("expected AgentVersion reuse on second deploy");
    }
    if (deploy2Body.agentVersionId !== versionId1) {
      throw new Error("AgentVersion id changed on identical deploy");
    }

    const inputJson = JSON.stringify({ message: "Hello OSVA" });
    const run1 = runNode(
      [cliBin, "run", "--wait", "--json", "--input", inputJson],
      { cwd: projectDir },
    );
    if (run1.status !== 0) {
      throw new Error(`run failed: ${run1.stderr}\n${run1.stdout}`);
    }
    const run1Body = JSON.parse(run1.stdout);
    if (run1Body.output?.greeting !== "Hello, Hello OSVA!") {
      throw new Error(`unexpected output: ${JSON.stringify(run1Body.output)}`);
    }

    const run2 = runNode(
      [cliBin, "run", "--wait", "--json", "--input", inputJson],
      { cwd: projectDir },
    );
    if (run2.status !== 0) {
      throw new Error(`second run failed: ${run2.stderr}`);
    }
    const run2Body = JSON.parse(run2.stdout);
    if (run2Body.runId === run1Body.runId) {
      throw new Error("expected a new Run id on second execution");
    }

    console.log(
      JSON.stringify(
        {
          acceptance: "m10-2e-live",
          ok: true,
          agentVersionId: versionId1,
          runIds: [run1Body.runId, run2Body.runId],
          reusedAgentVersion: deploy2Body.reusedAgentVersion,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
