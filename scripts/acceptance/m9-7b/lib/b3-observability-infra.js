import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ACCEPTANCE_LABEL, ACCEPTANCE_RUN_LABEL } from "./constants.js";
import { removeContainer, stopContainer, startContainer } from "./docker.js";
import { getRepoRoot } from "./stack.js";
import { waitUntil } from "./timeouts.js";

const COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.128.0";
const PROMETHEUS_IMAGE = "prom/prometheus:v3.5.0";

export async function startB3ObservabilityStack(dockerBin, runId) {
  const repoRoot = getRepoRoot();
  const collectorConfig = path.join(
    repoRoot,
    "deploy/observability/collector/otel-collector.yaml",
  );
  const prometheusConfigDir = path.join(
    repoRoot,
    "deploy/observability/prometheus",
  );

  const otlpPort = await startLabeledContainer(dockerBin, runId, {
    role: "otel-collector",
    image: COLLECTOR_IMAGE,
    containerPort: 4318,
    publishPorts: [
      { host: 4318, container: 4318 },
      { host: 8889, container: 8889 },
    ],
    extraArgs: [
      "-v",
      `${collectorConfig}:/etc/otelcol-contrib/config.yaml:ro`,
      COLLECTOR_IMAGE,
      "--config=/etc/otelcol-contrib/config.yaml",
    ],
  });

  const scrapeHostPort = otlpPort.hostPorts[8889];
  const promConfigPath = await writeAcceptancePrometheusConfig(
    prometheusConfigDir,
    scrapeHostPort,
  );

  const promPort = await startLabeledContainer(dockerBin, runId, {
    role: "prometheus",
    image: PROMETHEUS_IMAGE,
    containerPort: 9090,
    publishPorts: [{ host: 9090, container: 9090 }],
    extraArgs: [
      "-v",
      `${promConfigPath}:/etc/prometheus/prometheus.yml:ro`,
      "-v",
      `${prometheusConfigDir}/alerts.yml:/etc/prometheus/alerts.yml:ro`,
      "--add-host=host.docker.internal:host-gateway",
      PROMETHEUS_IMAGE,
      "--config.file=/etc/prometheus/prometheus.yml",
      "--web.enable-lifecycle",
    ],
  });

  const otlpEndpoint = `http://127.0.0.1:${otlpPort.hostPorts[4318]}`;
  const scrapeEndpoint = `http://127.0.0.1:${scrapeHostPort}`;
  const prometheusApi = `http://127.0.0.1:${promPort.hostPorts[9090]}`;

  await waitForHttpOk(`${scrapeEndpoint}/metrics`, 60_000);

  return {
    collectorContainer: otlpPort.containerName,
    prometheusContainer: promPort.containerName,
    otlpEndpoint,
    scrapeEndpoint,
    prometheusApi,
    prometheusConfigPath: promConfigPath,
  };
}

export async function stopB3ObservabilityStack(dockerBin, runId, stack) {
  if (!stack) {
    return;
  }
  await removeContainer(dockerBin, stack.collectorContainer, runId);
  await removeContainer(dockerBin, stack.prometheusContainer, runId);
  if (stack.prometheusConfigPath) {
    await fs.unlink(stack.prometheusConfigPath).catch(() => undefined);
  }
}

export async function stopCollectorOnly(dockerBin, runId, stack) {
  await stopContainer(dockerBin, stack.collectorContainer, runId);
}

export async function startCollectorOnly(dockerBin, runId, stack) {
  await startContainer(dockerBin, stack.collectorContainer, runId);
  await waitForHttpOk(`${stack.scrapeEndpoint}/metrics`, 60_000);
}

async function writeAcceptancePrometheusConfig(
  prometheusConfigDir,
  scrapePort,
) {
  const alertsPath = path.join(prometheusConfigDir, "alerts.yml");
  const config = `global:
  scrape_interval: 5s
  evaluation_interval: 5s

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: osva-otel-collector
    static_configs:
      - targets: ["host.docker.internal:${scrapePort}"]
        labels:
          scrape: osva-metrics
`;
  const filePath = path.join(os.tmpdir(), `osva-m97b-prom-${Date.now()}.yml`);
  await fs.writeFile(filePath, config, "utf8");
  return filePath;
}

async function startLabeledContainer(dockerBin, runId, spec) {
  const shortId = runId.replaceAll("-", "").slice(0, 12);
  const name = `osva-m97b-${shortId}-${spec.role}`;
  const hostPorts = {};
  const publishArgs = [];
  for (const entry of spec.publishPorts) {
    const hostPort = await allocateHostPort();
    hostPorts[entry.host] = hostPort;
    publishArgs.push("-p", `127.0.0.1:${hostPort}:${entry.container}`);
  }

  const args = [
    "run",
    "-d",
    "--label",
    `${ACCEPTANCE_LABEL}=true`,
    "--label",
    `${ACCEPTANCE_RUN_LABEL}=${runId}`,
    "--label",
    `osva.acceptance.role=${spec.role}`,
    "--name",
    name,
    ...publishArgs,
    ...spec.extraArgs,
  ];

  const result = spawnSync(dockerBin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `docker run ${spec.role} failed`,
    );
  }

  return { containerName: name, hostPorts };
}

async function allocateHostPort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate host port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function waitForHttpOk(url, timeoutMs) {
  await waitUntil(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs, message: `HTTP not ready: ${url}` },
  );
}

export function runPromtoolCheck(repoRoot, dockerBin) {
  const alerts = path.join(
    repoRoot,
    "deploy/observability/prometheus/alerts.yml",
  );
  const result = spawnSync(
    dockerBin,
    [
      "run",
      "--rm",
      "--entrypoint",
      "promtool",
      "-v",
      `${alerts}:/etc/alerts/alerts.yml:ro`,
      PROMETHEUS_IMAGE,
      "check",
      "rules",
      "/etc/alerts/alerts.yml",
    ],
    { encoding: "utf8" },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function runPnpmVitest(cwd, args, env = {}) {
  const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    stderr: result.stderr,
  };
}
