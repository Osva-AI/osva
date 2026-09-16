import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const CI_PYTHON = "3.11";

const REQUIRED_NODE_MAJOR = 24;

/**
 * @typedef {object} CommandSpec
 * @property {string} command
 * @property {string[]} prefixArgs
 * @property {string} [entry]
 * @property {string} [version]
 * @property {string} [source]
 * @property {boolean} [onPath]
 */

/**
 * @typedef {object} CommandResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: "inherit" | "pipe" }} [options]
 * @returns {Promise<CommandResult>}
 */
export function runCommand(command, args, options = {}) {
  const stdio = options.stdio ?? "inherit";
  const useShell =
    process.platform === "win32" &&
    (/\.(cmd|bat)$/i.test(command) ||
      ["pnpm", "npm", "npx", "turbo"].includes(command.toLowerCase()));
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell,
    });
    let stdout = "";
    let stderr = "";
    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
    }
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (stdio === "inherit") {
        console.error(message);
      }
      resolve({
        code: error && "code" in error && error.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: stderr || message,
      });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function readRootPackage() {
  const raw = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
  return JSON.parse(raw);
}

/**
 * @param {CommandSpec} spec
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: "inherit" | "pipe" }} [options]
 */
export function runSpec(spec, args, options = {}) {
  return runCommand(spec.command, [...spec.prefixArgs, ...args], options);
}

async function commandOnPath(name) {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(finder, [name], { stdio: "pipe" });
  if (result.code !== 0) {
    return undefined;
  }
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first;
}

async function captureVersion(spec) {
  const result = await runSpec(spec, ["--version"], { stdio: "pipe" });
  if (result.code !== 0) {
    return undefined;
  }
  return (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.trim();
}

function isTempPnpmShim(location) {
  const normalized = location.replaceAll("\\", "/").toLowerCase();
  return (
    normalized.includes("osva-pnpm-shim") ||
    normalized.includes("osva-verify-pnpm")
  );
}

async function resolveDocker() {
  const candidates = [
    "docker",
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    ),
    path.join(process.env.USERPROFILE ?? "", ".docker", "bin", "docker.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate !== "docker") {
      try {
        await fs.access(candidate);
      } catch {
        continue;
      }
    }
    const spec = { command: candidate, prefixArgs: [] };
    const version = await captureVersion(spec);
    if (!version) {
      continue;
    }
    const compose = await runSpec(spec, ["compose", "version"], {
      stdio: "pipe",
    });
    return {
      version,
      compose: compose.code === 0 ? compose.stdout.trim() : undefined,
      source: candidate,
    };
  }
  return { version: undefined, compose: undefined, source: undefined };
}

async function resolvePnpm(expectedVersion) {
  const execPath = process.env.npm_execpath;
  if (execPath && /pnpm/i.test(execPath) && !isTempPnpmShim(execPath)) {
    const spec = {
      command: process.execPath,
      prefixArgs: [execPath],
      entry: execPath,
      source: "npm_execpath",
      onPath: false,
    };
    spec.version = await captureVersion(spec);
    if (spec.version) {
      return spec;
    }
  }

  const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? os.homedir();
  const corepackEntry = path.join(
    home,
    "node",
    "corepack",
    "v1",
    "pnpm",
    expectedVersion,
    "bin",
    "pnpm.mjs",
  );
  try {
    await fs.access(corepackEntry);
    const spec = {
      command: process.execPath,
      prefixArgs: [corepackEntry],
      entry: corepackEntry,
      source: "corepack-cache",
      onPath: false,
    };
    spec.version = await captureVersion(spec);
    if (spec.version) {
      return spec;
    }
  } catch {
    // continue
  }

  const onPath = await commandOnPath("pnpm");
  if (onPath && !isTempPnpmShim(onPath)) {
    const spec = {
      command: process.execPath,
      prefixArgs: onPath.toLowerCase().endsWith(".mjs") ? [onPath] : [],
      entry: onPath.toLowerCase().endsWith(".mjs") ? onPath : undefined,
      source: onPath,
      onPath: true,
    };
    if (!spec.entry) {
      spec.command = "pnpm";
    }
    spec.version = await captureVersion(spec);
    if (spec.version) {
      return spec;
    }
  }

  const corepack = await commandOnPath("corepack");
  if (corepack) {
    const spec = {
      command: "corepack",
      prefixArgs: ["pnpm"],
      source: "corepack pnpm",
      onPath: false,
    };
    spec.version = await captureVersion(spec);
    if (spec.version) {
      return spec;
    }
  }

  return undefined;
}

async function resolvePython() {
  const candidates = [
    { command: "python", prefixArgs: [] },
    { command: "python3", prefixArgs: [] },
    { command: "py", prefixArgs: ["-3"] },
  ];
  for (const candidate of candidates) {
    const version = await captureVersion(candidate);
    if (!version) {
      continue;
    }
    const which = await commandOnPath(candidate.command);
    const executable = await runSpec(
      candidate,
      ["-c", "import sys; print(sys.executable)"],
      { stdio: "pipe" },
    );
    const executablePath = executable.stdout.trim();
    return {
      command: executablePath || candidate.command,
      prefixArgs: executablePath ? [] : candidate.prefixArgs,
      version: version.replace(/^Python\s+/i, ""),
      source: which ?? candidate.command,
      executable: executablePath || which || candidate.command,
    };
  }
  return undefined;
}

async function pythonImportCheck(python, modules, extraEnv = {}) {
  if (!python) {
    return {
      ok: false,
      missing: modules,
      detail: "Python executable not found.",
    };
  }
  const missing = [];
  const details = [];
  for (const moduleName of modules) {
    const result = await runSpec(
      python,
      [
        "-c",
        `import ${moduleName}; print(${JSON.stringify(moduleName)} + " OK")`,
      ],
      {
        stdio: "pipe",
        env: { ...process.env, ...extraEnv },
      },
    );
    if (result.code === 0) {
      details.push(result.stdout.trim() || `${moduleName} OK`);
    } else {
      missing.push(moduleName);
      details.push(
        (result.stderr || result.stdout).trim() || `${moduleName} missing`,
      );
    }
  }
  return { ok: missing.length === 0, missing, detail: details.join("\n") };
}

async function gitLineEndings() {
  const autocrlf = await runCommand(
    "git",
    ["config", "--get", "core.autocrlf"],
    {
      stdio: "pipe",
    },
  );
  const eol = await runCommand("git", ["config", "--get", "core.eol"], {
    stdio: "pipe",
  });
  const ls = await runCommand("git", ["ls-files", "--eol"], { stdio: "pipe" });
  let crlf = 0;
  let lf = 0;
  let mixed = 0;
  for (const line of ls.stdout.split(/\r?\n/)) {
    const match = line.match(/^\S+\s+w\/(\S+)/);
    if (!match) {
      continue;
    }
    if (match[1] === "crlf") {
      crlf += 1;
    } else if (match[1] === "lf") {
      lf += 1;
    } else if (match[1] === "mixed") {
      mixed += 1;
    }
  }
  let gitAttributes = "absent";
  try {
    const raw = await fs.readFile(
      path.join(REPO_ROOT, ".gitattributes"),
      "utf8",
    );
    gitAttributes = /eol=lf/.test(raw) ? "eol=lf" : "present without eol=lf";
  } catch {
    gitAttributes = "absent";
  }
  return {
    autocrlf: autocrlf.stdout.trim() || "(unset)",
    eol: eol.stdout.trim() || "(unset)",
    gitAttributes,
    workingTree: { crlf, lf, mixed },
  };
}

async function createPnpmShim(pnpm) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osva-verify-pnpm-"));
  if (pnpm.entry) {
    if (process.platform === "win32") {
      const body = `@echo off\r\n"${process.execPath}" "${pnpm.entry}" %*\r\n`;
      await fs.writeFile(path.join(dir, "pnpm.cmd"), body, "utf8");
    } else {
      const file = path.join(dir, "pnpm");
      await fs.writeFile(
        file,
        `#!/bin/sh\nexec "${process.execPath}" "${pnpm.entry}" "$@"\n`,
        { encoding: "utf8", mode: 0o755 },
      );
    }
    return dir;
  }
  if (process.platform === "win32") {
    const body = `@echo off\r\n${pnpm.command} ${pnpm.prefixArgs.join(" ")} %*\r\n`;
    await fs.writeFile(path.join(dir, "pnpm.cmd"), body, "utf8");
  } else {
    const file = path.join(dir, "pnpm");
    await fs.writeFile(
      file,
      `#!/bin/sh\nexec "${pnpm.command}" ${pnpm.prefixArgs.map((arg) => `"${arg}"`).join(" ")} "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
  }
  return dir;
}

let shimDirPromise;

export async function envWithPnpm(pnpm) {
  const env = { ...process.env };
  if (!pnpm || pnpm.onPath) {
    return env;
  }
  shimDirPromise ??= createPnpmShim(pnpm);
  const shimDir = await shimDirPromise;
  const nextPath = `${shimDir}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
  env.PATH = nextPath;
  env.Path = nextPath;
  return env;
}

export async function loadEnvironment() {
  const rootPackage = await readRootPackage();
  const expectedPnpm = String(rootPackage.packageManager ?? "")
    .replace(/^pnpm@/, "")
    .trim();
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "0",
    10,
  );
  const pnpm = await resolvePnpm(expectedPnpm);
  const python = await resolvePython();
  const pythonPath = path.join(REPO_ROOT, "sdks", "python", "src");
  const runtimeImports = await pythonImportCheck(
    python,
    ["httpx", "osva", "osva.runtime"],
    {
      PYTHONPATH: pythonPath,
    },
  );
  const pythonDevImports = await pythonImportCheck(python, [
    "ruff",
    "mypy",
    "pytest",
    "build",
  ]);
  const turboBin = path.join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "turbo.cmd" : "turbo",
  );
  let turboVersion;
  let turboPresent = false;
  try {
    await fs.access(turboBin);
    turboPresent = true;
  } catch {
    turboPresent = false;
  }
  if (pnpm) {
    const turbo = await runSpec(pnpm, ["exec", "turbo", "--version"], {
      stdio: "pipe",
      env: await envWithPnpm(pnpm),
    });
    if (turbo.code === 0) {
      turboPresent = true;
      turboVersion = turbo.stdout.trim().split(/\r?\n/)[0]?.trim();
    }
  }
  const pnpmPath = await commandOnPath("pnpm");
  const pnpmOnPath = Boolean(pnpmPath && !isTempPnpmShim(pnpmPath));
  const gitVersion = await captureVersion({ command: "git", prefixArgs: [] });
  const docker = await resolveDocker();
  const lineEndings = await gitLineEndings();
  const corepackPath = await commandOnPath("corepack");
  const corepackVersion = corepackPath
    ? await captureVersion({
        command: corepackPath,
        prefixArgs: [],
      })
    : undefined;

  return {
    rootPackage,
    expectedPnpm,
    node: {
      version: process.version,
      major: nodeMajor,
      executable: process.execPath,
      ok: nodeMajor >= REQUIRED_NODE_MAJOR,
    },
    pnpm,
    pnpmOnPath,
    turbo: {
      present: turboPresent,
      version: turboVersion,
      bin: turboBin,
      findsPnpm: pnpmOnPath,
    },
    python,
    runtimeImports,
    pythonDevImports,
    git: {
      version: gitVersion,
      platform: process.platform,
      lineEndings,
    },
    docker: {
      version: docker.version,
      compose: docker.compose,
      source: docker.source,
    },
    corepackVersion,
    ci: Boolean(process.env.GITHUB_ACTIONS) || process.env.CI === "true",
  };
}

export function pythonRuntimeEnv() {
  return {
    ...process.env,
    PYTHONPATH: path.join(REPO_ROOT, "sdks", "python", "src"),
  };
}

export function printDoctor(env) {
  const pnpmVersion = env.pnpm?.version ?? "not found";
  const pnpmSource = env.pnpm?.source ?? "missing";
  const pythonVersion = env.python?.version ?? "not found";
  const pythonSource =
    env.python?.executable ?? env.python?.source ?? "missing";
  const lines = [
    [
      "Node",
      `${env.node.version} (${env.node.executable})`,
      env.node.ok ? "OK" : "FAIL",
    ],
    [
      "packageManager",
      env.rootPackage.packageManager ?? "(unset)",
      env.rootPackage.packageManager ? "OK" : "FAIL",
    ],
    ["pnpm", `${pnpmVersion} via ${pnpmSource}`, env.pnpm ? "OK" : "FAIL"],
    [
      "pnpm on PATH",
      env.pnpmOnPath ? "yes" : "no",
      env.pnpmOnPath ? "OK" : "WARN",
    ],
    [
      "Turbo",
      env.turbo.version ?? (env.turbo.present ? "present" : "not found"),
      env.turbo.present ? "OK" : "FAIL",
    ],
    [
      "Turbo finds pnpm",
      env.turbo.findsPnpm ? "yes" : "no",
      env.turbo.findsPnpm ? "OK" : "WARN",
    ],
    [
      "Python",
      `${pythonVersion} (${pythonSource})`,
      env.python ? "OK" : "WARN",
    ],
    ["Local Python", pythonVersion, "INFO"],
    ["CI Python", CI_PYTHON, "INFO"],
    [
      "Python runtime",
      env.runtimeImports.ok
        ? "httpx, osva, osva.runtime"
        : `missing: ${env.runtimeImports.missing.join(", ") || "python"}`,
      env.runtimeImports.ok ? "OK" : "WARN",
    ],
    [
      "Python SDK tools",
      env.pythonDevImports.ok
        ? "ruff, mypy, pytest, build"
        : `missing: ${env.pythonDevImports.missing.join(", ") || "python"}`,
      env.pythonDevImports.ok ? "OK" : "WARN",
    ],
    ["Git", env.git.version ?? "not found", env.git.version ? "OK" : "FAIL"],
    ["Git platform", env.git.platform, "INFO"],
    ["core.autocrlf", env.git.lineEndings.autocrlf, "INFO"],
    ["core.eol", env.git.lineEndings.eol, "INFO"],
    [".gitattributes", env.git.lineEndings.gitAttributes, "INFO"],
    [
      "Working tree EOL",
      `LF ${String(env.git.lineEndings.workingTree.lf)} / CRLF ${String(env.git.lineEndings.workingTree.crlf)} / mixed ${String(env.git.lineEndings.workingTree.mixed)}`,
      "INFO",
    ],
    [
      "Docker",
      env.docker.version
        ? `${env.docker.version}${env.docker.source && env.docker.source !== "docker" ? ` via ${env.docker.source}` : ""}`
        : "not found (informational)",
      env.docker.version ? "OK" : "INFO",
    ],
    [
      "Docker Compose",
      env.docker.compose ?? "not found (informational)",
      env.docker.compose ? "OK" : "INFO",
    ],
  ];
  const labelWidth = Math.max(...lines.map(([label]) => label.length));
  for (const [label, value, status] of lines) {
    console.log(`${label.padEnd(labelWidth)}  ${status.padEnd(4)}  ${value}`);
  }

  if (!env.pnpmOnPath || !env.turbo.findsPnpm) {
    console.log("");
    console.log("Turbo/pnpm diagnosis:");
    console.log(
      `  package.json pins ${env.rootPackage.packageManager ?? "pnpm"}. Turbo locates that binary on PATH.`,
    );
    if (env.pnpm && !env.pnpmOnPath) {
      console.log(
        `  pnpm ${env.pnpm.version} is available via ${env.pnpm.source}, but \`pnpm\` is not on PATH.`,
      );
      if (env.corepackVersion) {
        console.log(`  Corepack ${env.corepackVersion} is installed.`);
      }
      console.log(
        "  Safe remediation: run `corepack enable` in a shell that can write Node's install directory so `pnpm` is shimmed next to node. This harness does not run that command.",
      );
      console.log(
        "  While verifying, the harness prepends a process-local pnpm shim so Turbo still runs `turbo run` (not a recursive pnpm substitute).",
      );
    } else if (!env.pnpm) {
      console.log(
        "  pnpm could not be resolved from PATH, Corepack, or npm_execpath. Install Node 24+ and enable Corepack, or add pnpm 12.4.1 to PATH.",
      );
    }
  }

  if (
    env.git.platform === "win32" &&
    env.git.lineEndings.workingTree.crlf > 0
  ) {
    console.log("");
    console.log("Git line endings:");
    console.log(
      `  This checkout has ${String(env.git.lineEndings.workingTree.crlf)} tracked files with CRLF in the working tree (index is LF; core.autocrlf=${env.git.lineEndings.autocrlf}).`,
    );
    console.log(
      "  .gitattributes requests LF. New clones should check out LF. This existing working tree is not rewritten by the harness.",
    );
  }

  if (
    env.python &&
    env.python.version &&
    !env.python.version.startsWith(CI_PYTHON)
  ) {
    console.log("");
    console.log(`Local Python: ${env.python.version}`);
    console.log(`CI Python: ${CI_PYTHON}`);
  }

  if (!env.docker.version) {
    console.log("");
    console.log(
      "Docker is absent. Local unit/typecheck verification still runs; compose-smoke remains a GitHub CI job.",
    );
  }
}

export function doctorFailures(env) {
  const failures = [];
  if (!env.node.ok) {
    failures.push(
      `Node ${env.node.version} does not satisfy >=${REQUIRED_NODE_MAJOR}.`,
    );
  }
  if (!env.pnpm) {
    failures.push("pnpm is required and could not be resolved.");
  }
  if (!env.git.version) {
    failures.push("git is required and was not found on PATH.");
  }
  return failures;
}

export function requireModePrereqs(mode, env) {
  const failures = doctorFailures(env);
  if (mode === "quick" || mode === "ci" || mode === "ci:clean") {
    if (!env.turbo.present) {
      failures.push(
        "Turbo is required. Run pnpm install from the repository root.",
      );
    }
  }
  if (mode === "ci" || mode === "ci:clean") {
    if (!env.python) {
      failures.push(
        "Python is required for integration tests (python-sdk-runtime E2E).",
      );
    } else if (mode === "ci" && !env.runtimeImports.ok) {
      failures.push(
        `Python runtime imports failed (${env.runtimeImports.missing.join(", ")}). Install with: python -m pip install -e ./sdks/python`,
      );
    }
  }
  if (mode === "python") {
    if (!env.python) {
      failures.push("Python is required for verify:python.");
    } else if (!env.pythonDevImports.ok) {
      failures.push(
        `Python SDK verification tools missing (${env.pythonDevImports.missing.join(", ")}). Install with: python -m pip install -e "./sdks/python[dev]"`,
      );
    }
  }
  return failures;
}
