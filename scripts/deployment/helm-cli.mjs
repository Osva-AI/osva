import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const HELM_DOCKER_IMAGE = "alpine/helm:3.16.4";

export function helmVersion() {
  const result = spawnSync(
    "docker",
    ["run", "--rm", HELM_DOCKER_IMAGE, "version", "--short"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to run Helm via Docker: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

export function runHelm(args, options = {}) {
  const mount = options.mount ?? REPO_ROOT;
  const normalizedArgs = args.map((arg) =>
    typeof arg === "string" ? arg.replaceAll("\\", "/") : arg,
  );
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${mount}:/work`,
      "-w",
      "/work",
      HELM_DOCKER_IMAGE,
      ...normalizedArgs,
    ],
    {
      encoding: "utf8",
      stdio: options.stdio ?? "pipe",
      cwd: options.cwd,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `helm ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}
