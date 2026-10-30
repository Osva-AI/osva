import type { DoctorCheck } from "../doctor/types.js";
import { redactSecrets } from "../doctor/redact.js";
import {
  assertComposeSuccess,
  buildComposeSpawnEnv,
  ComposeExecError,
  composeCommandIncludesDestructiveVolumeRemoval,
  runComposeCommand,
  type ComposeExecContext,
} from "./compose-exec.js";
import { loadComposeDistribution } from "./distribution.js";
import {
  MaterializeInstallError,
  materializeInstallation,
} from "./materialize-install.js";
import type { ProbeSpawnFn } from "./probe-spawn.js";
import { runSetupOnboarding } from "./run-onboarding.js";
import type { SetupOptions } from "./read-options.js";

export const COMPOSE_CONFIG_TIMEOUT_MS = 120_000;
export const COMPOSE_PULL_TIMEOUT_MS = 900_000;
export const COMPOSE_UP_TIMEOUT_MS = 900_000;

const PLATFORM_SERVICES = [
  "web",
  "worker",
  "scheduler",
  "workflow-orchestrator",
  "knowledge-worker",
  "mcp-server",
] as const;

export interface ProvisionDependencies {
  readonly spawn?: ProbeSpawnFn;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
}

export interface ProvisionResult {
  readonly checks: readonly DoctorCheck[];
  readonly setupTokenForOperator?: string;
}

export async function runSetupProvision(
  options: SetupOptions,
  deps: ProvisionDependencies = {},
): Promise<ProvisionResult> {
  const checks: DoctorCheck[] = [];
  let setupTokenForOperator: string | undefined;
  const processEnv = deps.processEnv ?? process.env;
  const spawn = deps.spawn;
  const fetchImpl = deps.fetch ?? fetch;

  try {
    const distribution = await loadComposeDistribution();
    checks.push(
      passCheck(
        "install_distribution",
        `Using bundled Compose distribution for platform ${distribution.manifest.platformVersion} (${distribution.manifest.imageRef}).`,
      ),
    );

    const materialized = await materializeInstallation({
      options,
      distribution,
      processEnv,
    });
    checks.push(
      passCheck(
        "install_directory",
        `Installation directory ${materialized.assessment.kind === "missing" ? "created at" : "ready at"} ${options.installDir}.`,
      ),
    );
    if (materialized.preservedSecrets) {
      checks.push(
        passCheck(
          "install_secrets",
          "Preserved existing installation secrets from .env (no credential rotation).",
        ),
      );
    } else {
      checks.push(
        passCheck(
          "install_secrets",
          "Generated new local secrets in .env (restricted permissions where supported).",
        ),
      );
    }

    const execCtx: ComposeExecContext = {
      installDir: options.installDir,
      envFilePath: materialized.envPath,
      projectName: materialized.envValues.COMPOSE_PROJECT_NAME,
    };

    const platformRunning = await detectFunctioningPlatform(execCtx, spawn);

    if (platformRunning && !options.authorizeExisting) {
      checks.push(
        warnCheck(
          "install_existing_deployment",
          "An existing OSVA Compose deployment appears operational.",
          "Re-run with --yes to reconcile images and services, or use a different --install-dir.",
        ),
      );
      checks.push(
        skipCheck(
          "compose_provision",
          "Skipped provisioning because an operational deployment was detected without --yes.",
        ),
      );
      checks.push(
        passCheck(
          "platform_services_ready",
          "Platform services appear ready (existing deployment).",
        ),
      );
      const onboarding = await runSetupOnboarding({
        options,
        execCtx,
        spawn,
        fetch: fetchImpl,
        mutateInstallation: false,
        processEnv,
      });
      checks.push(...onboarding.checks);
      setupTokenForOperator = onboarding.setupTokenForOperator;
      return { checks, setupTokenForOperator };
    }

    const reconcileRunning = platformRunning && options.authorizeExisting;

    validateComposeConfig(execCtx, spawn);
    checks.push(
      passCheck(
        "compose_config",
        "Validated Compose configuration (`docker compose config`).",
      ),
    );

    if (processEnv.OSVA_SETUP_SKIP_IMAGE_PULL?.trim() === "1") {
      checks.push(
        skipCheck(
          "compose_pull",
          "Skipped image pull (OSVA_SETUP_SKIP_IMAGE_PULL=1).",
        ),
      );
    } else {
      pullPinnedImages(execCtx, spawn);
      checks.push(
        passCheck("compose_pull", "Pulled pinned OSVA and dependency images."),
      );
    }

    if (!reconcileRunning) {
      startDataServices(execCtx, spawn);
      checks.push(
        passCheck("compose_data_plane", "PostgreSQL and Valkey are healthy."),
      );

      runMigrationJob(execCtx, spawn);
      checks.push(
        passCheck(
          "compose_migrate",
          "Database migration job completed successfully.",
        ),
      );
    } else {
      checks.push(
        skipCheck(
          "compose_data_plane",
          "Skipped data-plane restart during operational reconciliation.",
        ),
      );
      checks.push(
        skipCheck(
          "compose_migrate",
          "Skipped migration during operational reconciliation (--yes does not authorize online re-migration).",
        ),
      );
    }

    startPlatformServices(execCtx, spawn);
    checks.push(
      passCheck(
        "compose_platform_up",
        `Started platform services: ${PLATFORM_SERVICES.join(", ")}.`,
      ),
    );

    await verifyPlatformHealth(options.webPort, options.mcpPort, fetchImpl);
    checks.push(
      passCheck(
        "platform_services_ready",
        `Platform services are ready at http://127.0.0.1:${String(options.webPort)} and MCP http://127.0.0.1:${String(options.mcpPort)}.`,
      ),
    );
    const onboarding = await runSetupOnboarding({
      options,
      execCtx,
      spawn,
      fetch: fetchImpl,
      mutateInstallation: true,
      processEnv,
    });
    checks.push(...onboarding.checks);
    setupTokenForOperator = onboarding.setupTokenForOperator;
  } catch (error) {
    checks.push(mapProvisionError(error));
  }

  return { checks, setupTokenForOperator };
}

function validateComposeConfig(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["config"];
  assertNotDestructive(args);
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  assertComposeSuccess(result, "Compose configuration validation");
}

function pullPinnedImages(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["pull"];
  assertNotDestructive(args);
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_PULL_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  assertComposeSuccess(result, "Image pull");
}

function startDataServices(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["up", "-d", "--no-build", "--wait", "postgres", "valkey"];
  assertNotDestructive(args);
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_UP_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  assertComposeSuccess(result, "Starting PostgreSQL and Valkey");
}

function runMigrationJob(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["up", "--no-build", "--wait", "migrate"];
  assertNotDestructive(args);
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_UP_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  assertComposeSuccess(result, "Migration job");
}

function startPlatformServices(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["up", "-d", "--no-build", "--wait", ...PLATFORM_SERVICES];
  assertNotDestructive(args);
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_UP_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  assertComposeSuccess(result, "Starting platform services");
}

async function verifyPlatformHealth(
  webPort: number,
  mcpPort: number,
  fetchImpl: typeof fetch,
): Promise<void> {
  await waitForHttpOk(fetchImpl, `http://127.0.0.1:${String(webPort)}/health`);
  await waitForHttpOk(fetchImpl, `http://127.0.0.1:${String(webPort)}/ready`);
  await waitForHttpOk(fetchImpl, `http://127.0.0.1:${String(mcpPort)}/health`);
}

async function waitForHttpOk(
  fetchImpl: typeof fetch,
  url: string,
  attempts = 45,
): Promise<void> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      lastStatus = response.status;
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(2_000);
  }
  throw new ComposeExecError(
    "command_failed",
    `Timed out waiting for ${url}${lastStatus === undefined ? "" : ` (last status ${String(lastStatus)})`}.`,
  );
}

async function detectFunctioningPlatform(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<boolean> {
  const result = runComposeCommand(
    ctx,
    ["ps", "--status", "running", "--services"],
    {
      spawn,
      timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS,
      processEnv: buildComposeSpawnEnv(ctx),
    },
  );
  if (result.status !== 0) {
    return false;
  }
  const running = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  return running.has("web") && running.has("worker");
}

function mapProvisionError(error: unknown): DoctorCheck {
  if (error instanceof MaterializeInstallError) {
    if (error.code === "foreign_directory") {
      return failCheck(
        "install_directory",
        error.message,
        "Choose an empty directory or a prior OSVA installation path via --install-dir.",
      );
    }
    return failCheck(
      "install_env",
      error.message,
      "Unset conflicting host environment variables or align them with the installation .env file.",
    );
  }
  if (error instanceof ComposeExecError) {
    return failCheck(
      "compose_provision",
      redactSecrets(error.message),
      "Inspect Docker logs with `docker compose --project-directory <install-dir> logs` and retry `osva setup`.",
    );
  }
  if (error instanceof Error) {
    return failCheck(
      "compose_provision",
      redactSecrets(error.message),
      "Retry `osva setup` after resolving the reported issue.",
    );
  }
  return failCheck(
    "compose_provision",
    "Unexpected provisioning failure.",
    "Retry `osva setup` and inspect Docker state.",
  );
}

function assertNotDestructive(args: readonly string[]): void {
  if (composeCommandIncludesDestructiveVolumeRemoval(args)) {
    throw new Error(
      "Refusing destructive docker compose down -v during setup.",
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function passCheck(id: string, message: string): DoctorCheck {
  return { id, status: "PASS", message };
}

function warnCheck(
  id: string,
  message: string,
  remediation: string,
): DoctorCheck {
  return { id, status: "WARN", message, remediation };
}

function failCheck(
  id: string,
  message: string,
  remediation: string,
): DoctorCheck {
  return { id, status: "FAIL", message, remediation };
}

function skipCheck(id: string, message: string): DoctorCheck {
  return { id, status: "SKIP", message };
}
