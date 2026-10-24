#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const REQUIRED_DECLARATIONS = [
  "ArtifactBlobStore",
  "RegisteredArtifactBlobStoreModule",
  "ARTIFACT_STORAGE_DRIVER_REGISTERED",
];

function run(command, args, options = {}) {
  const useShell =
    options.shell ??
    (process.platform === "win32" &&
      (command === "pnpm" || command === "npm" || command === "npx"));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? "pipe",
    shell: useShell,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * @param {string} installedContractsRoot Absolute path to installed @osva-ai/contracts package root.
 */
export function assertPackedContractsArtifactExports(installedContractsRoot) {
  const indexDts = path.join(installedContractsRoot, "dist", "index.d.ts");
  const indexJs = path.join(installedContractsRoot, "dist", "index.js");
  const blobStoreDts = path.join(
    installedContractsRoot,
    "dist",
    "artifact-blob-store.d.ts",
  );
  const storageConfigJs = path.join(
    installedContractsRoot,
    "dist",
    "artifact-storage-config.js",
  );

  for (const file of [indexDts, indexJs, blobStoreDts, storageConfigJs]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `packed @osva-ai/contracts missing expected file: ${path.relative(REPO_ROOT, file) || file}`,
      );
    }
  }

  const declarations = fs.readFileSync(indexDts, "utf8");
  for (const symbol of REQUIRED_DECLARATIONS) {
    if (!declarations.includes(symbol)) {
      throw new Error(
        `dist/index.d.ts does not publicly export ${symbol} (packed contracts root export regression)`,
      );
    }
  }

  const runtimeSource = fs.readFileSync(indexJs, "utf8");
  if (!runtimeSource.includes("ARTIFACT_STORAGE_DRIVER_REGISTERED")) {
    throw new Error(
      "dist/index.js does not re-export ARTIFACT_STORAGE_DRIVER_REGISTERED",
    );
  }
}

/**
 * @param {string} tarballPath Absolute path to @osva-ai/contracts .tgz
 */
export function validateContractsTarballArtifactExports(tarballPath) {
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`contracts tarball not found: ${tarballPath}`);
  }

  const consumerDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "osva-contracts-pack-export-"),
  );
  const typesSmokePath = path.join(consumerDir, "types-smoke.ts");

  try {
    const packageJson = {
      name: "osva-contracts-pack-export-smoke",
      private: true,
      type: "module",
      dependencies: {
        "@osva-ai/contracts": `file:${tarballPath.replace(/\\/g, "/")}`,
      },
      devDependencies: {
        typescript: "6.0.3",
      },
    };
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8",
    );

    run("npm", ["install", "--omit=optional"], {
      cwd: consumerDir,
      stdio: "inherit",
    });

    const installedRoot = path.join(
      consumerDir,
      "node_modules",
      "@osva-ai",
      "contracts",
    );
    assertPackedContractsArtifactExports(installedRoot);

    const runtimeCheck = `
import { ARTIFACT_STORAGE_DRIVER_REGISTERED } from "@osva-ai/contracts";
if (ARTIFACT_STORAGE_DRIVER_REGISTERED !== "registered") {
  throw new Error(
    \`ARTIFACT_STORAGE_DRIVER_REGISTERED expected registered, got \${String(ARTIFACT_STORAGE_DRIVER_REGISTERED)}\`,
  );
}
console.log("contracts runtime export smoke ok");
`;
    fs.writeFileSync(
      path.join(consumerDir, "runtime-smoke.mjs"),
      runtimeCheck,
      "utf8",
    );
    run(process.execPath, ["runtime-smoke.mjs"], {
      cwd: consumerDir,
      stdio: "inherit",
    });

    const typesSmoke = `
import type {
  ArtifactBlobStore,
  RegisteredArtifactBlobStoreModule,
} from "@osva-ai/contracts";
import { ARTIFACT_STORAGE_DRIVER_REGISTERED } from "@osva-ai/contracts";

const storeShape: ArtifactBlobStore = {
  write: async () => ({ sizeBytes: 0, digest: "sha256:smoke" }),
  open: async () => ({ sizeBytes: 0, stream: undefined as never }),
  delete: async () => {},
};

const moduleShape: RegisteredArtifactBlobStoreModule = {
  createArtifactBlobStore: () => storeShape,
};

void storeShape;
void moduleShape;
void ARTIFACT_STORAGE_DRIVER_REGISTERED;
`;
    fs.writeFileSync(typesSmokePath, typesSmoke, "utf8");

    const tsconfig = {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["types-smoke.ts"],
    };
    fs.writeFileSync(
      path.join(consumerDir, "tsconfig.json"),
      `${JSON.stringify(tsconfig, null, 2)}\n`,
      "utf8",
    );

    run("npx", ["tsc", "-p", "tsconfig.json"], {
      cwd: consumerDir,
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(consumerDir, { force: true, recursive: true });
  }
}

export function packBuiltContractsTarball() {
  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@osva-ai/contracts"]);

  const packDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "osva-contracts-pack-"),
  );
  const stdout = run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: path.join(REPO_ROOT, "packages", "contracts"),
  });
  const tarballLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));
  if (!tarballLine) {
    throw new Error("pnpm pack did not report contracts tarball path");
  }
  const tarballPath = path.isAbsolute(tarballLine)
    ? tarballLine
    : path.join(packDir, path.basename(tarballLine));
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`contracts tarball missing: ${tarballPath}`);
  }
  return { tarballPath, packDir };
}

function main() {
  console.log("contracts pack artifact export regression");
  const { tarballPath, packDir } = packBuiltContractsTarball();
  try {
    validateContractsTarballArtifactExports(tarballPath);
    console.log("contracts pack artifact export regression PASS");
  } finally {
    fs.rmSync(packDir, { force: true, recursive: true });
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
