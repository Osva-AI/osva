import type { DoctorCheck } from "../doctor/types.js";
import { redactSecrets } from "../doctor/redact.js";
import {
  parseIdentityBootstrapSetupToken,
  parseWorkspaceBootstrapOutput,
  redactBootstrapSubprocessOutput,
} from "./bootstrap-capture.js";
import {
  assertComposeSuccess,
  buildComposeSpawnEnv,
  ComposeExecError,
  runComposeCommand,
  type ComposeExecContext,
} from "./compose-exec.js";
import {
  classifyAdministratorBootstrapPhase,
  parseInstallationStatusJson,
  type AdministratorBootstrapPhase,
  type InstallationStatusSnapshot,
} from "./installation-status.js";
import type { ProbeSpawnFn } from "./probe-spawn.js";
import {
  writeAcceptanceBootstrapKeyFile,
  writeAcceptanceSetupTokenFile,
} from "./acceptance-install.js";
import type { SetupOptions } from "./read-options.js";

export const COMPOSE_ONBOARDING_TIMEOUT_MS = 300_000;

export interface OnboardingResult {
  readonly checks: readonly DoctorCheck[];
  readonly consoleUrl: string;
  /** One-time password setup token for interactive display only (never persisted). */
  readonly setupTokenForOperator?: string;
  readonly administratorPhase: AdministratorBootstrapPhase | undefined;
}

export async function runSetupOnboarding(input: {
  readonly options: SetupOptions;
  readonly execCtx: ComposeExecContext;
  readonly spawn: ProbeSpawnFn | undefined;
  readonly fetch: typeof fetch;
  readonly mutateInstallation: boolean;
  readonly processEnv?: NodeJS.ProcessEnv;
}): Promise<OnboardingResult> {
  const processEnv = input.processEnv ?? process.env;
  const checks: DoctorCheck[] = [];
  const consoleUrl = `http://127.0.0.1:${String(input.options.consolePort)}`;
  let setupTokenForOperator: string | undefined;
  let administratorPhase: AdministratorBootstrapPhase | undefined;

  if (!(await probeConsoleDistribution(input.execCtx, input.spawn))) {
    checks.push(
      failCheck(
        "console_distribution",
        "The pinned OSVA image does not include Console assets (apps/console).",
        "Re-run `osva setup --yes` after upgrading OSVA_IMAGE to a release that packages Console, or install a matching CLI bundle.",
      ),
    );
    checks.push(
      skipCheck(
        "console_ready",
        "Skipped Console readiness because Console is unavailable in the OSVA image.",
      ),
    );
    checks.push(
      skipCheck(
        "administrator_bootstrapped",
        "Skipped administrator bootstrap because Console distribution is unavailable.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  checks.push(
    passCheck(
      "console_distribution",
      "Console server assets are present in the pinned OSVA image.",
    ),
  );

  if (input.mutateInstallation) {
    startConsoleService(input.execCtx, input.spawn);
  }

  try {
    await waitForConsoleReady(input.fetch, consoleUrl);
    checks.push(
      passCheck("console_ready", `Console is ready at ${consoleUrl}.`),
    );
  } catch (error) {
    checks.push(
      failCheck(
        "console_ready",
        redactSecrets(
          error instanceof Error
            ? error.message
            : "Console did not become ready.",
        ),
        "Inspect `docker compose --project-directory <install-dir> logs console` and retry `osva setup`.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  let status: InstallationStatusSnapshot;
  try {
    status = await readInstallationStatus(input.execCtx, input.spawn);
  } catch (error) {
    checks.push(
      failCheck(
        "administrator_bootstrapped",
        redactSecrets(
          error instanceof Error
            ? error.message
            : "Could not read installation status.",
        ),
        "Ensure PostgreSQL is healthy, then retry `osva setup`.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  administratorPhase = classifyAdministratorBootstrapPhase(status);

  if (!input.mutateInstallation) {
    checks.push(
      ...reportReadOnlyAdministratorState(administratorPhase, consoleUrl),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  if (administratorPhase === "administrator_ready") {
    checks.push(
      passCheck(
        "administrator_bootstrapped",
        "A human administrator is already linked to this installation.",
      ),
    );
    checks.push(
      passCheck(
        "administrator_setup_complete",
        "Initial administrator password setup appears complete.",
      ),
    );
    checks.push(
      passCheck(
        "installation_complete",
        `Installation complete. Open ${consoleUrl}, sign in, and continue Console onboarding.`,
      ),
    );
    checks.push(
      skipCheck(
        "first_agent_run_succeeded",
        "First agent execution is not verified by the installer; complete Agent Studio onboarding in the Console.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  if (administratorPhase === "administrator_pending_password_setup") {
    checks.push(
      passCheck(
        "administrator_bootstrapped",
        "Human administrator exists but password setup is still pending.",
      ),
    );
    checks.push(
      skipCheck(
        "administrator_setup_complete",
        `Complete password setup at ${consoleUrl}/setup before signing in.`,
      ),
    );
    checks.push(
      skipCheck(
        "installation_complete",
        "Installation is not complete until administrator password setup and sign-in succeed.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  if (administratorPhase === "multiple_unlinked_workspaces") {
    checks.push(
      warnCheck(
        "administrator_bootstrapped",
        "Multiple workspaces exist without linked human administrators.",
        "Run identity bootstrap manually with explicit --workspace-id values for each workspace, or consolidate workspaces before retrying `osva setup`.",
      ),
    );
    checks.push(
      skipCheck(
        "installation_complete",
        "Installation is not complete until each workspace has a linked human administrator.",
      ),
    );
    return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
  }

  if (status.apiKeyCount === 0) {
    try {
      await runWorkspaceBootstrapJob(
        input.execCtx,
        input.spawn,
        input.options,
        processEnv,
      );
      status = await readInstallationStatus(input.execCtx, input.spawn);
      administratorPhase = classifyAdministratorBootstrapPhase(status);
    } catch (error) {
      checks.push(
        failCheck(
          "administrator_bootstrapped",
          redactSecrets(
            error instanceof Error
              ? error.message
              : "Workspace bootstrap failed.",
          ),
          "Inspect bootstrap job logs and retry `osva setup`.",
        ),
      );
      return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
    }
  }

  if (
    administratorPhase === "fresh_installation" ||
    administratorPhase === "workspace_without_human_administrator" ||
    administratorPhase === "ambiguous_workspace_state"
  ) {
    if (input.options.adminEmail.trim().length === 0) {
      checks.push(
        failCheck(
          "administrator_bootstrapped",
          "Administrator email is required for initial human identity bootstrap.",
          "Re-run with --admin-email owner@example.com (and optional --admin-name / --organization-name).",
        ),
      );
      checks.push(
        skipCheck(
          "installation_complete",
          "Installation is not complete until administrator bootstrap succeeds.",
        ),
      );
      return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
    }

    try {
      const token = await runIdentityBootstrapJob(
        input.execCtx,
        input.spawn,
        input.options,
        status,
      );
      setupTokenForOperator = token;
      if (token !== undefined) {
        await writeAcceptanceSetupTokenFile({ processEnv, token });
      }
      checks.push(
        passCheck(
          "administrator_bootstrapped",
          `Initial human administrator ${input.options.adminEmail} was linked to the workspace.`,
        ),
      );
      if (token !== undefined) {
        checks.push(
          skipCheck(
            "administrator_setup_complete",
            `Open ${consoleUrl}/setup and enter the one-time setup token printed below (not stored in installation files or JSON output).`,
          ),
        );
      }
      checks.push(
        skipCheck(
          "installation_complete",
          "Installation is not complete until password setup and sign-in succeed in the Console.",
        ),
      );
      checks.push(
        skipCheck(
          "first_agent_run_succeeded",
          "First agent execution is not verified by the installer.",
        ),
      );
    } catch (error) {
      checks.push(
        failCheck(
          "administrator_bootstrapped",
          redactSecrets(
            error instanceof Error
              ? error.message
              : "Human identity bootstrap failed.",
          ),
          "Resolve the reported issue and retry `osva setup` (existing organizations are not reset).",
        ),
      );
    }
  }

  return { checks, consoleUrl, setupTokenForOperator, administratorPhase };
}

function reportReadOnlyAdministratorState(
  phase: AdministratorBootstrapPhase,
  consoleUrl: string,
): DoctorCheck[] {
  if (phase === "administrator_ready") {
    return [
      passCheck(
        "administrator_bootstrapped",
        "Human administrator is configured.",
      ),
      passCheck(
        "administrator_setup_complete",
        "Initial administrator password setup appears complete.",
      ),
      skipCheck(
        "installation_complete",
        `Platform is operational. Open ${consoleUrl} to sign in (re-run with --yes to reconcile services).`,
      ),
    ];
  }
  if (phase === "administrator_pending_password_setup") {
    return [
      passCheck(
        "administrator_bootstrapped",
        "Human administrator exists; password setup is pending.",
      ),
      skipCheck(
        "administrator_setup_complete",
        `Complete setup at ${consoleUrl}/setup (re-run with --yes to reconcile services).`,
      ),
    ];
  }
  return [
    skipCheck(
      "administrator_bootstrapped",
      "Human administrator bootstrap is incomplete. Re-run `osva setup --yes` with --admin-email to continue.",
    ),
  ];
}

async function probeConsoleDistribution(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<boolean> {
  const script =
    "try{require('fs').accessSync('/app/apps/console/dist/server/main.js');process.exit(0)}catch{process.exit(2)}";
  const result = runComposeCommand(
    ctx,
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "node",
      "web",
      "-e",
      script,
    ],
    {
      spawn,
      timeoutMs: COMPOSE_ONBOARDING_TIMEOUT_MS,
      processEnv: buildComposeSpawnEnv(ctx),
    },
  );
  return result.status === 0;
}

function startConsoleService(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): void {
  const result = runComposeCommand(
    ctx,
    ["up", "-d", "--no-build", "--wait", "console"],
    {
      spawn,
      timeoutMs: COMPOSE_ONBOARDING_TIMEOUT_MS,
      processEnv: buildComposeSpawnEnv(ctx),
    },
  );
  assertComposeSuccess(result, "Starting Console");
}

async function waitForConsoleReady(
  fetchImpl: typeof fetch,
  consoleUrl: string,
): Promise<void> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const response = await fetchImpl(`${consoleUrl}/`);
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
    `Timed out waiting for Console at ${consoleUrl}${lastStatus === undefined ? "" : ` (last status ${String(lastStatus)})`}.`,
  );
}

async function readInstallationStatus(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<InstallationStatusSnapshot> {
  const result = runComposeCommand(
    ctx,
    ["--profile", "bootstrap", "run", "--rm", "-T", "installation-status"],
    {
      spawn,
      timeoutMs: COMPOSE_ONBOARDING_TIMEOUT_MS,
      processEnv: buildComposeSpawnEnv(ctx),
    },
  );
  assertComposeSuccess(result, "Installation status probe");
  return parseInstallationStatusJson(result.stdout);
}

async function runWorkspaceBootstrapJob(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
  options: SetupOptions,
  processEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const args = [
    "--profile",
    "bootstrap",
    "run",
    "--rm",
    "-T",
    "-e",
    `OSVA_BOOTSTRAP_WORKSPACE_NAME=${options.workspaceName}`,
    "bootstrap",
  ];
  const result = runComposeCommand(ctx, args, {
    spawn,
    timeoutMs: COMPOSE_ONBOARDING_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  if (result.status !== 0) {
    const detail = redactBootstrapSubprocessOutput(
      result.stderr || result.stdout,
    );
    throw new ComposeExecError(
      "command_failed",
      detail.length > 0 ? detail : "Workspace bootstrap failed.",
    );
  }
  const parsed = parseWorkspaceBootstrapOutput(result.stdout);
  if (!parsed.alreadyCompleted && parsed.workspaceId === undefined) {
    throw new ComposeExecError(
      "command_failed",
      "Workspace bootstrap completed without a workspace id.",
    );
  }
  if (parsed.apiKey !== undefined) {
    await writeAcceptanceBootstrapKeyFile({
      processEnv,
      apiKey: parsed.apiKey,
    });
  }
}

async function runIdentityBootstrapJob(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
  options: SetupOptions,
  status: InstallationStatusSnapshot,
): Promise<string | undefined> {
  const identityArgs = [
    "--profile",
    "bootstrap",
    "run",
    "--rm",
    "-T",
    "identity-bootstrap",
    "--",
    "--email",
    options.adminEmail,
    "--name",
    options.adminName,
    "--organization-name",
    options.organizationName,
  ];

  if (status.unlinkedWorkspaceIds.length === 1) {
    identityArgs.push(
      "--workspace-id",
      status.unlinkedWorkspaceIds[0] as string,
    );
  } else if (status.unlinkedWorkspaceIds.length > 1) {
    identityArgs.push("--all-unlinked-workspaces");
  } else if (status.workspaceCount === 1) {
    const workspaceBootstrap = await readLatestWorkspaceId(ctx, spawn);
    if (workspaceBootstrap !== undefined) {
      identityArgs.push("--workspace-id", workspaceBootstrap);
    }
  }

  const result = runComposeCommand(ctx, identityArgs, {
    spawn,
    timeoutMs: COMPOSE_ONBOARDING_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  if (result.status !== 0) {
    const detail = redactBootstrapSubprocessOutput(
      result.stderr || result.stdout,
    );
    throw new ComposeExecError(
      "command_failed",
      detail.length > 0 ? detail : "Human identity bootstrap failed.",
    );
  }
  return parseIdentityBootstrapSetupToken(result.stdout);
}

async function readLatestWorkspaceId(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<string | undefined> {
  const status = await readInstallationStatus(ctx, spawn);
  if (status.unlinkedWorkspaceIds.length === 1) {
    return status.unlinkedWorkspaceIds[0];
  }
  return status.unlinkedWorkspaceIds[0];
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
