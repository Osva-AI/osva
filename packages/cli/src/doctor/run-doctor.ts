import { CLI_VERSION } from "../version.js";
import {
  createFetchProbeTransport,
  createNodeProbeTransport,
  type DoctorProbeTransport,
  type HttpProbeResult,
} from "./http-probe.js";
import { redactSecrets } from "./redact.js";
import type {
  DoctorCheck,
  DoctorProbeOptions,
  DoctorReport,
  DoctorEnv,
} from "./types.js";

export const REQUIRED_NODE_MAJOR = 24;
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export async function runDoctorPipeline(
  env: DoctorEnv,
  options: DoctorProbeOptions = {},
): Promise<DoctorReport> {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const transport =
    options.fetch === undefined
      ? createNodeProbeTransport(probeTimeoutMs)
      : createFetchProbeTransport(options.fetch, probeTimeoutMs);
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeRuntime());
  checks.push(checkCliVersion());

  const baseUrlCheck = checkBaseUrl(env.baseUrl);
  checks.push(baseUrlCheck);

  const normalizedBaseUrl =
    baseUrlCheck.status === "PASS" ? normalizeBaseUrl(env.baseUrl!) : undefined;

  if (normalizedBaseUrl === undefined) {
    checks.push(
      skipCheck("api_reachability", "No valid OSVA_BASE_URL configured."),
    );
    checks.push(
      skipCheck("control_plane_ready", "No valid OSVA_BASE_URL configured."),
    );
    checks.push(
      env.apiKey === undefined
        ? skipCheck(
            "api_key",
            "Skipped because OSVA_BASE_URL is not configured.",
          )
        : warnCheck(
            "api_key",
            "OSVA_API_KEY is set but OSVA_BASE_URL is missing.",
            "Set OSVA_BASE_URL or pass --base-url to the control plane URL.",
          ),
    );
    checks.push(
      skipCheck("authentication", "No valid OSVA_BASE_URL configured."),
    );
    checks.push(
      skipCheck("workspace_access", "No valid OSVA_BASE_URL configured."),
    );
    return finalizeReport(checks);
  }

  const reachability = await probeHealth(normalizedBaseUrl, transport);
  checks.push(reachability);
  if (reachability.status !== "PASS") {
    checks.push(
      skipCheck(
        "control_plane_ready",
        "Skipped because the control plane endpoint is not reachable.",
      ),
    );
    checks.push(apiKeyCheck(env.apiKey));
    checks.push(
      skipCheck(
        "authentication",
        "Skipped because the control plane is unreachable.",
      ),
    );
    checks.push(
      skipCheck(
        "workspace_access",
        "Skipped because the control plane is unreachable.",
      ),
    );
    return finalizeReport(checks);
  }

  checks.push(await probeReady(normalizedBaseUrl, transport));

  const apiKeyResult = apiKeyCheck(env.apiKey);
  checks.push(apiKeyResult);

  if (env.apiKey === undefined) {
    checks.push(
      skipCheck(
        "authentication",
        "OSVA_API_KEY is not set; cannot verify credentials.",
      ),
    );
    checks.push(
      skipCheck(
        "workspace_access",
        "OSVA_API_KEY is not set; cannot verify workspace access.",
      ),
    );
    return finalizeReport(checks);
  }

  checks.push(
    ...(await evaluateAuthAndWorkspace(
      normalizedBaseUrl,
      env.apiKey,
      env.workspaceId,
      transport,
    )),
  );

  return finalizeReport(checks);
}

function checkNodeRuntime(): DoctorCheck {
  const version = process.version;
  const match = /^v(\d+)\./.exec(version);
  const major = match === null ? NaN : Number.parseInt(match[1]!, 10);
  if (Number.isFinite(major) && major >= REQUIRED_NODE_MAJOR) {
    return passCheck(
      "node_runtime",
      `Node.js ${version} satisfies >=${String(REQUIRED_NODE_MAJOR)}.`,
    );
  }
  return failCheck(
    "node_runtime",
    `Node.js ${version} does not satisfy >=${String(REQUIRED_NODE_MAJOR)}.`,
    `Install Node.js ${String(REQUIRED_NODE_MAJOR)} or newer (see packages/cli engines).`,
  );
}

function checkCliVersion(): DoctorCheck {
  return passCheck("cli_version", `OSVA CLI ${CLI_VERSION}.`);
}

function checkBaseUrl(baseUrl: string | undefined): DoctorCheck {
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    return failCheck(
      "base_url",
      "OSVA_BASE_URL is not set.",
      "Export OSVA_BASE_URL (or pass --base-url) to your control plane, e.g. http://127.0.0.1:8080.",
    );
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failCheck(
        "base_url",
        `OSVA_BASE_URL must use http or https (got ${url.protocol}).`,
        "Use a full URL such as http://127.0.0.1:8080.",
      );
    }
    if (url.username.length > 0 || url.password.length > 0) {
      return failCheck(
        "base_url",
        "OSVA_BASE_URL must not embed credentials.",
        "Remove userinfo from the URL and set OSVA_API_KEY separately.",
      );
    }
    return passCheck(
      "base_url",
      `OSVA_BASE_URL is ${normalizeBaseUrl(baseUrl)}.`,
    );
  } catch {
    return failCheck(
      "base_url",
      "OSVA_BASE_URL is not a valid URL.",
      "Use a full URL such as http://127.0.0.1:8080.",
    );
  }
}

function apiKeyCheck(apiKey: string | undefined): DoctorCheck {
  if (apiKey === undefined) {
    return warnCheck(
      "api_key",
      "OSVA_API_KEY is not set.",
      "Create or copy an API key from your OSVA workspace bootstrap output and export OSVA_API_KEY.",
    );
  }
  if (!apiKey.startsWith("osva_ak_")) {
    return warnCheck(
      "api_key",
      "OSVA_API_KEY is set but does not look like an OSVA API key.",
      "Expected a value starting with osva_ak_.",
    );
  }
  return passCheck("api_key", "OSVA_API_KEY is set.");
}

async function probeHealth(
  baseUrl: string,
  transport: DoctorProbeTransport,
): Promise<DoctorCheck> {
  const result = await transport.getJson(`${baseUrl}/health`);
  if (result.kind === "transport") {
    return failCheck(
      "api_reachability",
      redactSecrets(`Control plane is unreachable at ${baseUrl}.`),
      "Start the web process (Compose, Helm, or pnpm dev:web) and confirm OSVA_BASE_URL.",
    );
  }
  if (result.kind === "timeout") {
    return failCheck(
      "api_reachability",
      redactSecrets(`Timed out reaching ${baseUrl}/health.`),
      "Check network connectivity, firewalls, and that the control plane is listening.",
    );
  }
  if (result.status !== 200) {
    return failCheck(
      "api_reachability",
      `GET /health returned HTTP ${String(result.status)}.`,
      "Confirm OSVA_BASE_URL points at the OSVA web control plane.",
    );
  }
  const status =
    typeof result.body === "object" &&
    result.body !== null &&
    "status" in result.body &&
    (result.body as { status?: unknown }).status;
  if (status !== "ok") {
    return warnCheck(
      "api_reachability",
      "GET /health succeeded but the response was unexpected.",
      "The host may not be an OSVA control plane.",
    );
  }
  return passCheck("api_reachability", "GET /health returned HTTP 200.");
}

async function probeReady(
  baseUrl: string,
  transport: DoctorProbeTransport,
): Promise<DoctorCheck> {
  const result = await transport.getJson(`${baseUrl}/ready`);
  if (result.kind === "transport") {
    return failCheck(
      "control_plane_ready",
      redactSecrets(`Could not reach ${baseUrl}/ready.`),
      "Verify the control plane is running.",
    );
  }
  if (result.kind === "timeout") {
    return failCheck(
      "control_plane_ready",
      "Timed out on GET /ready.",
      "Check dependency connectivity to the web process.",
    );
  }
  if (result.status === 200) {
    return passCheck(
      "control_plane_ready",
      "GET /ready returned HTTP 200 (PostgreSQL and Valkey reachable).",
    );
  }
  if (result.status === 503) {
    const detail = readyFailureDetail(result.body);
    return failCheck(
      "control_plane_ready",
      `GET /ready returned HTTP 503${detail}.`,
      "Ensure PostgreSQL and Valkey are running and reachable from the web process (see deploy/compose or RUNBOOK.md).",
    );
  }
  return failCheck(
    "control_plane_ready",
    `GET /ready returned HTTP ${String(result.status)}.`,
    "Inspect web logs and dependency configuration.",
  );
}

function readyFailureDetail(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const failed = (body as { failedDependency?: unknown }).failedDependency;
  if (typeof failed === "string" && failed.length > 0) {
    return ` (${failed})`;
  }
  const failedMany = (body as { failedDependencies?: unknown })
    .failedDependencies;
  if (Array.isArray(failedMany) && failedMany.length > 0) {
    return ` (${failedMany.map(String).join(", ")})`;
  }
  return "";
}

interface AuthContext {
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly role: string;
}

async function evaluateAuthAndWorkspace(
  baseUrl: string,
  apiKey: string,
  configuredWorkspaceId: string | undefined,
  transport: DoctorProbeTransport,
): Promise<readonly [DoctorCheck, DoctorCheck]> {
  const result = await transport.getJson(`${baseUrl}/v1/auth/context`, {
    authorization: `Bearer ${apiKey}`,
  });
  const authCheck = mapAuthProbeResult(result);
  if (authCheck.status !== "PASS") {
    const workspaceCheck =
      configuredWorkspaceId === undefined
        ? skipCheck(
            "workspace_access",
            "OSVA_WORKSPACE_ID is not set; workspace scoping is derived from the API key.",
          )
        : failCheck(
            "workspace_access",
            "Skipped workspace verification because authentication failed.",
            "Fix OSVA_API_KEY and rerun osva doctor.",
          );
    if (authCheck.id !== "authentication") {
      return [
        failCheck(
          "authentication",
          authCheck.message,
          authCheck.remediation ??
            "Verify OSVA_API_KEY and control-plane availability.",
        ),
        workspaceCheck,
      ];
    }
    return [authCheck, workspaceCheck];
  }

  const context = parseAuthContext(result.kind === "ok" ? result.body : null);
  if (context === null) {
    return [
      failCheck(
        "authentication",
        "GET /v1/auth/context returned an unexpected body.",
        "Confirm OSVA_BASE_URL points at an OSVA control plane.",
      ),
      configuredWorkspaceId === undefined
        ? skipCheck(
            "workspace_access",
            "OSVA_WORKSPACE_ID is not set; workspace scoping is derived from the API key.",
          )
        : failCheck(
            "workspace_access",
            "Skipped workspace verification because authentication response was invalid.",
            "Fix control-plane connectivity and rerun osva doctor.",
          ),
    ];
  }

  const authentication = passCheck(
    "authentication",
    `API key is valid (workspace ${context.workspaceId}, role ${context.role}).`,
  );
  if (configuredWorkspaceId === undefined) {
    return [
      authentication,
      skipCheck(
        "workspace_access",
        "OSVA_WORKSPACE_ID is not set; workspace scoping is derived from the API key.",
      ),
    ];
  }
  if (context.workspaceId === configuredWorkspaceId) {
    return [
      authentication,
      passCheck(
        "workspace_access",
        `OSVA_WORKSPACE_ID matches the authenticated workspace (${context.workspaceId}).`,
      ),
    ];
  }
  return [
    authentication,
    failCheck(
      "workspace_access",
      `OSVA_WORKSPACE_ID (${configuredWorkspaceId}) does not match the API key workspace (${context.workspaceId}).`,
      "Use the workspace from bootstrap output or unset OSVA_WORKSPACE_ID for CLI-only usage.",
    ),
  ];
}

function mapAuthProbeResult(result: HttpProbeResult): DoctorCheck {
  if (result.kind === "transport") {
    return failCheck(
      "authentication",
      "OSVA API transport failed.",
      "Verify OSVA_BASE_URL and that /v1 routes are reachable.",
    );
  }
  if (result.kind === "timeout") {
    return failCheck(
      "authentication",
      "OSVA API request timed out.",
      "Increase network stability or check control-plane load.",
    );
  }
  if (result.status === 401) {
    return failCheck(
      "authentication",
      "API key was rejected (HTTP 401 AUTHENTICATION_REQUIRED).",
      "Verify OSVA_API_KEY matches a key issued for this OSVA installation.",
    );
  }
  if (result.status === 503) {
    return failCheck(
      "authentication",
      "Authentication could not be verified (HTTP 503 SERVICE_UNAVAILABLE).",
      "The rate-limit store may be unavailable; retry after Valkey is healthy.",
    );
  }
  if (result.status !== 200) {
    const domain =
      typeof result.body === "object" &&
      result.body !== null &&
      "status" in result.body &&
      typeof (result.body as { status?: unknown }).status === "string"
        ? (result.body as { status: string }).status
        : "error";
    return failCheck(
      "authentication",
      redactSecrets(
        `Authenticated request failed with HTTP ${String(result.status)} (${domain}).`,
      ),
      "Inspect control-plane logs using the request ID when available.",
    );
  }
  return passCheck("authentication", "API key is valid.");
}

function parseAuthContext(body: unknown): AuthContext | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.subjectId === "string" &&
    record.subjectId.length > 0 &&
    typeof record.workspaceId === "string" &&
    record.workspaceId.length > 0 &&
    typeof record.role === "string" &&
    record.role.length > 0
  ) {
    return {
      subjectId: record.subjectId,
      workspaceId: record.workspaceId,
      role: record.role,
    };
  }
  return null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
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

function finalizeReport(checks: DoctorCheck[]): DoctorReport {
  const hasFail = checks.some((check) => check.status === "FAIL");
  const hasWarn = checks.some((check) => check.status === "WARN");
  const result = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  return { result, checks };
}

export function doctorExitCode(report: DoctorReport): number {
  return report.result === "fail" ? 1 : 0;
}
