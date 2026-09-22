#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawn } from "node:child_process";

import { readReleaseVersion } from "../release/read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const FIXTURES = path.join(
  REPO_ROOT,
  "scripts",
  "deployment",
  "kind",
  "fixtures",
);
const CHART_DIR = path.join(REPO_ROOT, "deploy", "helm", "osva");
const VALUES = path.join(
  REPO_ROOT,
  "scripts",
  "deployment",
  "kind",
  "values-acceptance.yaml",
);
const CLUSTER_NAME = process.env.OSVA_KIND_CLUSTER ?? "osva-acceptance";
const NAMESPACE = "osva-acceptance";
const RELEASE = "osva";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}

function requireBinary(name) {
  const check = spawnSync(name, ["version"], { encoding: "utf8" });
  if (check.status !== 0) {
    throw new Error(`${name} is required for kind acceptance`);
  }
}

async function waitHttp(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function kubectl(args, options = {}) {
  return run("kubectl", args, options);
}

function kind(args, options = {}) {
  return run("kind", args, options);
}

function helm(args, options = {}) {
  return run("helm", args, options);
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

async function main() {
  const version = readReleaseVersion();
  const imageTag = process.env.OSVA_IMAGE ?? `osva:${version}`;
  const imageRepo = imageTag.includes(":") ? imageTag.split(":")[0] : imageTag;
  const imageTagOnly = imageTag.includes(":")
    ? imageTag.split(":")[1]
    : "acceptance";

  requireBinary("kind");
  requireBinary("kubectl");

  console.log(`kind acceptance (image ${imageRepo}:${imageTagOnly})`);

  try {
    kind(["delete", "cluster", "--name", CLUSTER_NAME], { stdio: "inherit" });
  } catch {
    // cluster may not exist
  }

  kind(["create", "cluster", "--name", CLUSTER_NAME], { stdio: "inherit" });

  run("docker", ["build", "-t", `${imageRepo}:${imageTagOnly}`, "."], {
    stdio: "inherit",
  });
  kind(
    [
      "load",
      "docker-image",
      `${imageRepo}:${imageTagOnly}`,
      "--name",
      CLUSTER_NAME,
    ],
    {
      stdio: "inherit",
    },
  );

  for (const file of ["namespace.yaml", "postgres.yaml", "valkey.yaml"]) {
    kubectl(["apply", "-f", path.join(FIXTURES, file)], { stdio: "inherit" });
  }

  kubectl(
    [
      "wait",
      "--for=condition=available",
      "deployment/postgres",
      "-n",
      NAMESPACE,
      "--timeout=180s",
    ],
    { stdio: "inherit" },
  );
  kubectl(
    [
      "wait",
      "--for=condition=available",
      "deployment/valkey",
      "-n",
      NAMESPACE,
      "--timeout=120s",
    ],
    { stdio: "inherit" },
  );

  helm(
    [
      "upgrade",
      "--install",
      RELEASE,
      CHART_DIR,
      "-n",
      NAMESPACE,
      "-f",
      VALUES,
      "--set",
      `image.repository=${imageRepo}`,
      "--set",
      `image.tag=${imageTagOnly}`,
      "--wait",
      "--timeout",
      "10m",
    ],
    { stdio: "inherit" },
  );

  kubectl(
    [
      "wait",
      "--for=condition=available",
      "deployment/osva-web",
      "-n",
      NAMESPACE,
      "--timeout=300s",
    ],
    { stdio: "inherit" },
  );

  spawnDetached("kubectl", [
    "-n",
    NAMESPACE,
    "port-forward",
    "svc/osva-web",
    "19080:80",
  ]);
  spawnDetached("kubectl", [
    "-n",
    NAMESPACE,
    "port-forward",
    "svc/osva-mcp",
    "19100:80",
  ]);

  await waitHttp("http://127.0.0.1:19080/health");
  await waitHttp("http://127.0.0.1:19080/ready");
  await waitHttp("http://127.0.0.1:19100/health");

  const bootstrapJob = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "osva-bootstrap-once", namespace: NAMESPACE },
    spec: {
      backoffLimit: 0,
      template: {
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "bootstrap",
              image: `${imageRepo}:${imageTagOnly}`,
              env: [
                { name: "OSVA_PROCESS", value: "bootstrap" },
                {
                  name: "OSVA_DATABASE_URL",
                  value: `postgres://osva:osva-acceptance@postgres.${NAMESPACE}.svc.cluster.local:5432/osva`,
                },
              ],
            },
          ],
        },
      },
    },
  };
  const jobPath = path.join(
    os.tmpdir(),
    `osva-kind-bootstrap-${Date.now()}.yaml`,
  );
  fs.mkdirSync(path.dirname(jobPath), { recursive: true });
  fs.writeFileSync(jobPath, JSON.stringify(bootstrapJob), "utf8");
  kubectl(
    [
      "delete",
      "job",
      "osva-bootstrap-once",
      "-n",
      NAMESPACE,
      "--ignore-not-found",
    ],
    {
      stdio: "inherit",
    },
  );
  kubectl(["apply", "-f", jobPath], { stdio: "inherit" });
  kubectl(
    [
      "wait",
      "--for=condition=complete",
      "job/osva-bootstrap-once",
      "-n",
      NAMESPACE,
      "--timeout=180s",
    ],
    { stdio: "inherit" },
  );
  const bootstrapLogs = kubectl(
    ["logs", "job/osva-bootstrap-once", "-n", NAMESPACE],
    { stdio: "pipe" },
  );
  const tokenMatch = bootstrapLogs.match(
    /osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/,
  );
  if (!tokenMatch) {
    throw new Error("Bootstrap did not emit API key token");
  }
  const token = tokenMatch[0];

  const apiResponse = await fetch("http://127.0.0.1:19080/v1/api-keys", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!apiResponse.ok) {
    throw new Error(`/v1/api-keys returned HTTP ${apiResponse.status}`);
  }

  console.log("kind acceptance PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
