import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runInit } from "../src/init/run-init.js";
import { ensureAgentVersion } from "../src/project/ensure-agent-version.js";
import {
  manifestFingerprint,
  manifestsMatch,
} from "../src/project/manifest.js";
import { parseRunInput } from "../src/project/parse-run-input.js";
import { parseComposeProjectNameField } from "../src/project/compose-volume.js";
import { installTrustedRuntimeArtifact } from "../src/project/install-trusted-runtime.js";
import { runDeployPipeline } from "../src/project/run-deploy.js";
import { runRunPipeline } from "../src/project/run-run.js";
import {
  assertDeploymentContext,
  readDeploymentState,
  writeDeploymentState,
} from "../src/project/state.js";
import type { AgentManifestV1 } from "@osva-ai/contracts";
import { runValidatePipeline } from "../src/validate/run-validate.js";
import { sha256IntegrityOfFile } from "../src/validate/integrity.js";
import {
  removeTempDir,
  runCliSubprocess,
} from "./helpers/run-cli-subprocess.js";

function trustedManifestFields(manifest: AgentManifestV1): {
  entrypoint: string;
  integrity: string;
} {
  const runtime = manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    throw new Error("expected TRUSTED_TYPESCRIPT manifest");
  }
  return { entrypoint: runtime.entrypoint, integrity: runtime.integrity };
}

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((dir) => removeTempDir(dir)));
});

async function makeTempRoot(label = "osva-deploy"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
  tempRoots.push(dir);
  return dir;
}

async function createBuiltProject(
  parentDir: string,
  projectName: string,
): Promise<string> {
  const init = await runInit({ projectName, cwd: parentDir });
  expect(init.ok).toBe(true);
  if (!init.ok) {
    throw new Error("init failed");
  }
  const projectDir = init.projectDir;
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCmd, ["install", "--no-fund", "--no-audit"], {
      cwd: projectDir,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install failed: ${String(code)}`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCmd, ["run", "build"], {
      cwd: projectDir,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run build failed: ${String(code)}`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCmd, ["run", "manifest"], {
      cwd: projectDir,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run manifest failed: ${String(code)}`));
    });
  });
  return projectDir;
}

describe("project deploy helpers", () => {
  it("matches manifests independent of property order", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "manifest-agent");
    const manifestRaw = await readFile(
      path.join(projectDir, "osva.manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as AgentManifestV1;
    const reordered = JSON.parse(manifestRaw) as AgentManifestV1;
    expect(manifestsMatch(manifest, reordered)).toBe(true);
    expect(manifestFingerprint(manifest)).toBe(manifestFingerprint(reordered));
  }, 120_000);

  it("installs host trusted-runtime bytes with matching digest", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "host-agent");
    const report = await runValidatePipeline(projectDir);
    expect(report.result).toBe("pass");

    const manifestRaw = await readFile(
      path.join(projectDir, "osva.manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as AgentManifestV1;
    const { entrypoint, integrity } = trustedManifestFields(manifest);
    const trustedRoot = path.join(parent, "trusted-runtime");
    const installed = await installTrustedRuntimeArtifact({
      projectDir,
      manifest,
      deployEnv: {
        deployMode: "host",
        trustedRuntimeRoot: trustedRoot,
        composeDir: undefined,
        composeProject: undefined,
        composeProjectNameEnv: undefined,
        runPollIntervalMs: 500,
        runPollTimeoutMs: 5000,
      },
    });

    const installedPath = path.join(trustedRoot, entrypoint);
    const fromDisk = await sha256IntegrityOfFile(installedPath);
    expect(installed.integrity).toBe(fromDisk);
    expect(installed.integrity).toBe(integrity);
  }, 120_000);

  it("reuses AgentVersion when manifest fingerprint matches", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "ensure-agent");
    const manifestRaw = await readFile(
      path.join(projectDir, "osva.manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw) as AgentManifestV1;
    const { entrypoint, integrity } = trustedManifestFields(manifest);

    const listVersions = vi
      .fn()
      .mockResolvedValueOnce({ versions: [] })
      .mockResolvedValueOnce({
        versions: [{ id: "av-existing", manifest }],
      });

    const client = {
      agents: {
        list: vi.fn().mockResolvedValue({
          agents: [
            {
              id: "agent-1",
              key: manifest.key,
              workspaceId: "ws-1",
            },
          ],
        }),
        create: vi.fn(),
        createVersion: vi.fn().mockResolvedValue({ id: "av-new" }),
        get: vi.fn().mockResolvedValue({
          id: "agent-1",
          workspaceId: "ws-1",
        }),
        getVersion: vi.fn().mockResolvedValue({ manifest }),
        listVersions,
      },
    };

    const first = await ensureAgentVersion({
      client: client as never,
      projectDir,
      baseUrl: "http://127.0.0.1:8080",
      workspaceId: "ws-1",
      manifest,
      integrity,
      deployTarget: "/tmp/agent.js",
      entrypoint,
    });
    expect(first.reused).toBe(false);
    expect(client.agents.createVersion).toHaveBeenCalledTimes(1);

    const second = await ensureAgentVersion({
      client: client as never,
      projectDir,
      baseUrl: "http://127.0.0.1:8080",
      workspaceId: "ws-1",
      manifest,
      integrity,
      deployTarget: "/tmp/agent.js",
      entrypoint,
    });
    expect(second.reused).toBe(true);
    expect(second.agentVersionId).toBe("av-new");
    expect(client.agents.createVersion).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("rejects stale deployment context", async () => {
    const parent = await makeTempRoot();
    const projectDir = path.join(parent, "stale-agent");
    await mkdir(projectDir, { recursive: true });
    await writeDeploymentState(projectDir, {
      schemaVersion: "1",
      baseUrl: "http://127.0.0.1:8080",
      workspaceId: "ws-1",
      agentKey: "stale-agent",
      agentId: "agent-1",
      agentVersionId: "av-1",
      manifestFingerprint: "fp-old",
      integrity:
        "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      deployTarget: "/tmp/x",
      entrypoint: "agent.js",
      updatedAt: new Date().toISOString(),
    });

    const state = await readDeploymentState(projectDir);
    expect(state).not.toBeNull();
    expect(() =>
      assertDeploymentContext({
        state: state!,
        baseUrl: "http://127.0.0.1:9999",
        workspaceId: "ws-1",
        manifestFingerprint: "fp-old",
        integrity: state!.integrity,
      }),
    ).toThrow(/OSVA_BASE_URL/);
  });

  it("parses compose project name from compose.yml", () => {
    expect(
      parseComposeProjectNameField("name: my-compose\nservices:\n  web: {}"),
    ).toBe("my-compose");
  });

  it("blocks deploy when validation fails on stale integrity", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "bad-integrity");
    const manifestPath = path.join(projectDir, "osva.manifest.json");
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as AgentManifestV1 & {
      runtime: { integrity: string };
    };
    manifest.runtime.integrity =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const result = await runDeployPipeline({
      config: {
        baseUrl: "http://127.0.0.1:8080",
        apiKey: "osva_ak_test.placeholder",
        json: false,
      },
      flags: {},
      cwd: projectDir,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.validateStdout).toContain("artifact_integrity");
  }, 120_000);

  it("requires deploy before run", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "run-no-deploy");
    vi.stubEnv("OSVA_TRUSTED_RUNTIME_MODE", "host");
    vi.stubEnv(
      "OSVA_TRUSTED_RUNTIME_ROOT",
      path.join(parent, "trusted-runtime"),
    );
    const result = await runRunPipeline({
      config: {
        baseUrl: "http://127.0.0.1:8080",
        apiKey: "osva_ak_test.placeholder",
        json: false,
      },
      flags: { input: '{"message":"Hello"}' },
      cwd: projectDir,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.message).toContain("osva deploy");
  }, 120_000);

  it("parses inline and file JSON input safely", async () => {
    const parent = await makeTempRoot();
    const projectDir = await mkdir(path.join(parent, "proj"), {
      recursive: true,
    }).then(() => path.join(parent, "proj"));
    await writeFile(
      path.join(projectDir, "input.json"),
      JSON.stringify({ message: "from-file" }),
      "utf8",
    );

    const inline = await parseRunInput({
      projectDir,
      flags: { input: '{"message":"inline"}' },
    });
    expect(inline).toEqual({ message: "inline" });

    const fromFile = await parseRunInput({
      projectDir,
      flags: { "input-file": "input.json" },
    });
    expect(fromFile).toEqual({ message: "from-file" });
  });
});

describe("osva deploy/run CLI", () => {
  it("requires credentials for deploy", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "cli-deploy-auth");
    const result = await runCliSubprocess(["deploy", "--json"], {
      cwd: projectDir,
      env: {
        OSVA_API_KEY: "",
        OSVA_BASE_URL: "",
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("OSVA_BASE_URL");
    expect(result.stderr).not.toMatch(/osva_ak_/);
  }, 120_000);

  it("emits deploy JSON with redacted stderr on missing trusted runtime config", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "cli-deploy-config");
    const result = await runCliSubprocess(["deploy", "--json"], {
      cwd: projectDir,
      env: {
        OSVA_BASE_URL: "http://127.0.0.1:8080",
        OSVA_API_KEY: "osva_ak_test.placeholder",
        OSVA_TRUSTED_RUNTIME_MODE: "",
        OSVA_TRUSTED_RUNTIME_ROOT: "",
        OSVA_COMPOSE_DIR: "",
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Compose deploy mode requires OSVA_COMPOSE_DIR",
    );
    expect(result.stderr).not.toMatch(/osva_ak_test/);
  }, 120_000);

  it("lists deploy and run in help", async () => {
    const result = await runCliSubprocess(["help"], {
      cwd: process.cwd(),
      env: {
        OSVA_API_KEY: "",
        OSVA_BASE_URL: "",
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("status");
  });
});
