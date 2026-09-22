#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawn } from "node:child_process";

import { KUBECTL_PREFLIGHT_ARGS, requireBinary } from "./kind-preflight.mjs";
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

const APPLICATION_DEPLOYMENTS = [
  "osva-web",
  "osva-worker",
  "osva-scheduler",
  "osva-workflow-orchestrator",
  "osva-knowledge-worker",
  "osva-mcp",
];

const POD_FAIL_WAITING_REASONS = new Set([
  "CrashLoopBackOff",
  "Error",
  "CreateContainerConfigError",
  "ImagePullBackOff",
  "ErrImagePull",
  "RunContainerError",
]);

const APP_READINESS_BUDGET_MS = Number(
  process.env.OSVA_KIND_APP_READY_MS ?? 120_000,
);
const APP_READINESS_POLL_MS = 2_500;

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

function runOptional(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env },
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function waitHttp(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.status;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fetchWithRetry(url, options = {}, attempts = 30) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError ?? new Error(`Timed out fetching ${url}`);
}

function kubectl(args, options = {}) {
  return run("kubectl", args, options);
}

function kubectlJson(args) {
  const stdout = kubectl([...args, "-o", "json"]);
  return JSON.parse(stdout);
}

function kind(args, options = {}) {
  return run("kind", args, options);
}

function helm(args, options = {}) {
  return run("helm", args, options);
}

function tryKubectl(args) {
  const result = spawnSync("kubectl", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) {
    console.error(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function isOsvaApplicationPod(pod) {
  const labels = pod.metadata?.labels ?? {};
  const component = labels["app.kubernetes.io/component"];
  if (!component || component === "migrate") {
    return false;
  }
  return APPLICATION_DEPLOYMENTS.some((name) =>
    pod.metadata?.name?.startsWith(`${name}-`),
  );
}

function collectPodFailure(pod) {
  const reasons = [];
  const podReady =
    pod.status?.conditions?.find((c) => c.type === "Ready")?.status === "True";
  const statuses = pod.status?.containerStatuses ?? [];
  for (const status of statuses) {
    const waiting = status.state?.waiting;
    if (waiting?.reason && POD_FAIL_WAITING_REASONS.has(waiting.reason)) {
      reasons.push(
        `${pod.metadata.name}/${status.name}: ${waiting.reason}${waiting.message ? ` (${waiting.message})` : ""}`,
      );
    }
    if (podReady && status.ready) {
      continue;
    }
    const terminated = status.lastState?.terminated;
    if (
      terminated &&
      typeof terminated.exitCode === "number" &&
      terminated.exitCode !== 0 &&
      !status.ready
    ) {
      reasons.push(
        `${pod.metadata.name}/${status.name}: exited ${terminated.exitCode}${terminated.reason ? ` (${terminated.reason})` : ""}`,
      );
    }
  }
  return reasons;
}

function deploymentIsAvailable(deployment) {
  const desired = deployment.status?.replicas ?? deployment.spec?.replicas ?? 1;
  const available = deployment.status?.availableReplicas ?? 0;
  const unavailable = deployment.status?.unavailableReplicas ?? 0;
  return available >= desired && unavailable === 0;
}

function dumpKindAcceptanceDiagnostics() {
  console.error("::group::kind acceptance diagnostics");
  tryKubectl(["get", "deployments,pods", "-n", NAMESPACE, "-o", "wide"]);
  tryKubectl(["get", "events", "-n", NAMESPACE, "--sort-by=.lastTimestamp"]);
  tryKubectl(["get", "jobs", "-n", NAMESPACE, "-o", "wide"]);
  tryKubectl(["describe", `job/${RELEASE}-migrate`, "-n", NAMESPACE]);
  tryKubectl([
    "logs",
    "-n",
    NAMESPACE,
    "-l",
    "app.kubernetes.io/component=migrate",
    "--all-containers=true",
    "--tail=300",
  ]);

  const pods = kubectlJson(["get", "pods", "-n", NAMESPACE]).items ?? [];
  const nonReadyPods = pods.filter((pod) => {
    if (!isOsvaApplicationPod(pod)) {
      return false;
    }
    const phase = pod.status?.phase;
    if (phase !== "Running" && phase !== "Succeeded") {
      return true;
    }
    const ready =
      pod.status?.conditions?.find((c) => c.type === "Ready")?.status ===
      "True";
    return !ready;
  });

  for (const pod of nonReadyPods) {
    const name = pod.metadata.name;
    tryKubectl(["describe", "pod", name, "-n", NAMESPACE]);
    tryKubectl([
      "logs",
      name,
      "-n",
      NAMESPACE,
      "--all-containers=true",
      "--tail=300",
    ]);
    tryKubectl([
      "logs",
      name,
      "-n",
      NAMESPACE,
      "--all-containers=true",
      "--previous",
      "--tail=300",
    ]);
  }
  console.error("::endgroup::");
}

async function waitForApplicationDeployments() {
  const deadline = Date.now() + APP_READINESS_BUDGET_MS;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const deployments =
      kubectlJson(["get", "deployments", "-n", NAMESPACE]).items ?? [];
    const appDeployments = deployments.filter((d) =>
      APPLICATION_DEPLOYMENTS.includes(d.metadata?.name),
    );

    const pods = kubectlJson(["get", "pods", "-n", NAMESPACE]).items ?? [];
    const podFailures = [];
    for (const pod of pods) {
      if (!isOsvaApplicationPod(pod)) {
        continue;
      }
      podFailures.push(...collectPodFailure(pod));
    }
    if (podFailures.length > 0) {
      dumpKindAcceptanceDiagnostics();
      throw new Error(
        `Application pod failure detected:\n${podFailures.join("\n")}`,
      );
    }

    const missing = APPLICATION_DEPLOYMENTS.filter(
      (name) => !appDeployments.some((d) => d.metadata?.name === name),
    );
    if (missing.length > 0) {
      lastStatus = `waiting for deployments: ${missing.join(", ")}`;
    } else {
      const notReady = appDeployments.filter((d) => !deploymentIsAvailable(d));
      if (notReady.length === 0) {
        for (const name of APPLICATION_DEPLOYMENTS) {
          console.log(`${name} Deployment ready\nPASS`);
        }
        return;
      }
      lastStatus = `waiting for ready: ${notReady
        .map((d) => d.metadata.name)
        .join(", ")}`;
    }

    await new Promise((resolve) => setTimeout(resolve, APP_READINESS_POLL_MS));
  }

  dumpKindAcceptanceDiagnostics();
  throw new Error(
    `Timed out waiting for application deployments (${APP_READINESS_BUDGET_MS}ms). Last: ${lastStatus}`,
  );
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

function dockerImageExists(imageRef) {
  const result = runOptional("docker", [
    "image",
    "inspect",
    imageRef,
    "--format",
    "{{.Id}}",
  ]);
  return result.ok && result.stdout.trim().length > 0;
}

async function main() {
  const version = readReleaseVersion();
  const imageTag = process.env.OSVA_IMAGE ?? `osva:${version}`;
  const imageRepo = imageTag.includes(":") ? imageTag.split(":")[0] : imageTag;
  const imageTagOnly = imageTag.includes(":")
    ? imageTag.split(":")[1]
    : "acceptance";
  const fullImage = `${imageRepo}:${imageTagOnly}`;

  requireBinary("kind");
  requireBinary("kubectl", KUBECTL_PREFLIGHT_ARGS);
  requireBinary("helm");

  console.log(`kind acceptance (image ${fullImage})`);

  try {
    kind(["delete", "cluster", "--name", CLUSTER_NAME], { stdio: "inherit" });
  } catch {
    // cluster may not exist
  }

  kind(["create", "cluster", "--name", CLUSTER_NAME], { stdio: "inherit" });
  console.log("kind cluster created\nPASS");

  const reuseImage = process.env.OSVA_KIND_REUSE_IMAGE === "true";
  if (reuseImage) {
    if (!dockerImageExists(fullImage)) {
      throw new Error(
        `OSVA_KIND_REUSE_IMAGE=true but image ${fullImage} was not found locally`,
      );
    }
    console.log(`OSVA image ${fullImage} (reused)\nPASS`);
  } else {
    run("docker", ["build", "-t", fullImage, "."], {
      stdio: "inherit",
    });
    console.log("OSVA image built\nPASS");
  }

  kind(["load", "docker-image", fullImage, "--name", CLUSTER_NAME], {
    stdio: "inherit",
  });
  console.log("image loaded\nPASS");

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
  console.log("PostgreSQL ready\nPASS");

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
  console.log("Valkey ready\nPASS");

  try {
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
        "--timeout",
        "2m",
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    dumpKindAcceptanceDiagnostics();
    throw error;
  }
  console.log("migration hook\nPASS");

  await waitForApplicationDeployments();

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

  const healthStatus = await waitHttp("http://127.0.0.1:19080/health");
  console.log(`GET web /health\n${healthStatus}`);
  const readyStatus = await waitHttp("http://127.0.0.1:19080/ready");
  console.log(`GET web /ready\n${readyStatus}`);
  const mcpHealthStatus = await waitHttp("http://127.0.0.1:19100/health");
  console.log(`GET MCP /health\n${mcpHealthStatus}`);

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
              image: fullImage,
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
  console.log("bootstrap Job\nPASS");

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
  console.log("bootstrap emits API key\nPASS");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const apiResponse = await fetchWithRetry(
    "http://127.0.0.1:19080/v1/api-keys",
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!apiResponse.ok) {
    throw new Error(`/v1/api-keys returned HTTP ${apiResponse.status}`);
  }
  console.log("authenticated GET /v1/api-keys\n200");

  console.log("kind acceptance PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
