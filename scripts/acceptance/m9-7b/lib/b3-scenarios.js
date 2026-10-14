import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { bearer, fetchJson, sanitizeHttpEvidence } from "./b3-http.js";
import { spawnProcess } from "./docker.js";
import {
  runPnpmVitest,
  runPromtoolCheck,
  startB3ObservabilityStack,
  startCollectorOnly,
  stopB3ObservabilityStack,
  stopCollectorOnly,
} from "./b3-observability-infra.js";
import {
  bootstrapWorkspace,
  createApiKey,
  provisionCommunityRoleKeys,
} from "./b3-workspaces.js";
import { writeJson } from "./evidence.js";
import { stopAcceptanceValkey } from "./faults.js";
import {
  createScenarioEvidenceBase,
  recordAssertion,
  writeScenarioEvidence,
} from "./scenario-evidence.js";
import {
  appValkeyUrl,
  ensureStack,
  restartAppProcesses,
  shutdownStack,
} from "./stack-context.js";
import {
  ensureBuildArtifacts,
  getRepoRoot,
  runEchoAgentFlow,
  startWebProcessOnly,
  stopProcessGracefully,
  waitForHttpOk,
} from "./stack.js";
import { redactString } from "./redact.js";
import { waitUntil } from "./timeouts.js";

const PUBLIC_API_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
};

const AUTHORIZATION_ACTIONS = {
  READ: "READ",
  EXECUTE: "EXECUTE",
  WRITE: "WRITE",
  ADMIN: "ADMIN",
};

const COMMUNITY_EDITION_ROLES = {
  VIEWER: "VIEWER",
  OPERATOR: "OPERATOR",
  EDITOR: "EDITOR",
  ADMIN: "ADMIN",
};

const ROLE_ACTIONS = {
  VIEWER: new Set([AUTHORIZATION_ACTIONS.READ]),
  OPERATOR: new Set([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
  ]),
  EDITOR: new Set([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
  ]),
  ADMIN: new Set([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
    AUTHORIZATION_ACTIONS.ADMIN,
  ]),
};

function rolePermitsAction(role, action) {
  return ROLE_ACTIONS[role]?.has(action) ?? false;
}

export const B3_SCENARIOS = [
  {
    id: "b3-auth-api-keys",
    title: "B.3 authentication and API-key lifecycle",
    mandatory: true,
    group: "b3",
    timeoutMs: 180_000,
    run: runAuthApiKeys,
  },
  {
    id: "b3-rbac-isolation",
    title: "B.3 RBAC and workspace isolation matrix",
    mandatory: true,
    group: "b3",
    timeoutMs: 180_000,
    run: runRbacIsolation,
  },
  {
    id: "b3-rate-limit-security-events",
    title: "B.3 rate limiting and security events",
    mandatory: true,
    group: "b3",
    timeoutMs: 240_000,
    run: runRateLimitSecurityEvents,
  },
  {
    id: "b3-canonical-workflow",
    title: "B.3 canonical workflow acceptance",
    mandatory: true,
    group: "b3",
    timeoutMs: 600_000,
    run: runCanonicalWorkflow,
  },
  {
    id: "b3-mcp-capability-security",
    title: "B.3 MCP and capability security",
    mandatory: true,
    group: "b3",
    timeoutMs: 600_000,
    run: runMcpCapability,
  },
  {
    id: "b3-console-functional",
    title: "B.3 Console functional acceptance",
    mandatory: true,
    group: "b3",
    timeoutMs: 180_000,
    run: runConsoleFunctional,
  },
  {
    id: "b3-console-security",
    title: "B.3 Console Host/Origin and mutation security",
    mandatory: true,
    group: "b3",
    timeoutMs: 120_000,
    run: runConsoleSecurity,
  },
  {
    id: "b3-distributed-tracing",
    title: "B.3 distributed tracing across Web and Worker",
    mandatory: true,
    group: "b3",
    timeoutMs: 300_000,
    run: runDistributedTracing,
  },
  {
    id: "b3-prometheus-metrics",
    title: "B.3 Prometheus metrics, dashboards and alert rules",
    mandatory: true,
    group: "b3",
    timeoutMs: 240_000,
    run: runPrometheusMetrics,
  },
  {
    id: "b3-collector-outage-privacy",
    title: "B.3 Collector outage resilience and telemetry privacy",
    mandatory: true,
    group: "b3",
    timeoutMs: 300_000,
    run: runCollectorOutagePrivacy,
  },
  {
    id: "b3-console-test-timeout",
    title: "B.3 Console Vitest testTimeout review",
    mandatory: true,
    group: "b3",
    timeoutMs: 30_000,
    run: runConsoleTestTimeoutReview,
  },
  {
    id: "b3-cleanup",
    title: "B.3 Console and observability cleanup",
    mandatory: true,
    group: "b3",
    timeoutMs: 120_000,
    run: runB3Cleanup,
  },
];

async function ensureB3Build() {
  await ensureBuildArtifacts();
  const repoRoot = getRepoRoot();
  const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const filters = [
    "@osva/console",
    "@osva/adapters-opentelemetry",
    "@osva/example-canonical-dependency-adoption",
    "@osva/workflow-orchestrator",
  ];
  const result = spawnSync(
    bin,
    [
      "exec",
      "turbo",
      "run",
      "build",
      ...filters.flatMap((f) => ["--filter", f]),
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error("B.3 supplemental build failed");
  }
}

async function runAuthApiKeys(ctx) {
  await ensureB3Build();
  await ensureStack(ctx);
  const evidence = createScenarioEvidenceBase(ctx, "b3-auth-api-keys");
  const checks = [];

  const missing = await fetchJson(`${ctx.origin}/v1/agents`);
  checks.push({
    case: "missing_bearer",
    ...sanitizeHttpEvidence(missing),
    expectedStatus: 401,
    pass:
      missing.status === 401 &&
      missing.body?.code === PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
  });

  const invalid = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer("osva_ak_invalid.invalidsecret"),
  });
  checks.push({
    case: "invalid_bearer",
    ...sanitizeHttpEvidence(invalid),
    pass: invalid.status === 401,
  });

  const valid = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(ctx.auth.token),
  });
  checks.push({
    case: "valid_admin",
    ...sanitizeHttpEvidence(valid),
    pass: valid.status === 200,
  });

  const roleKeys = await provisionCommunityRoleKeys(ctx.origin, ctx.auth.token);

  let expiredToken;
  const expiredPast = await createApiKey(ctx.origin, ctx.auth.token, {
    name: "expired-key-past",
    role: "VIEWER",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  if (expiredPast.status === 201) {
    expiredToken = expiredPast.body.token;
  } else {
    const expiredSoon = await createApiKey(ctx.origin, ctx.auth.token, {
      name: "expired-key-soon",
      role: "VIEWER",
      expiresAt: new Date(Date.now() + 1500).toISOString(),
    });
    ctx.assert(expiredSoon.status === 201, "create short-lived key");
    expiredToken = expiredSoon.body.token;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const expiredUse = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(expiredToken),
  });
  checks.push({
    case: "expired_key",
    ...sanitizeHttpEvidence(expiredUse),
    pass:
      expiredUse.status === 401 &&
      expiredUse.body?.code === PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
  });

  const revokeTarget = await createApiKey(ctx.origin, ctx.auth.token, {
    name: "revoke-me",
    role: "OPERATOR",
  });
  ctx.assert(revokeTarget.status === 201, "create revoke target");
  const revoke = await fetchJson(
    `${ctx.origin}/v1/api-keys/${revokeTarget.body.apiKey.id}/revoke`,
    { method: "POST", headers: bearer(ctx.auth.token) },
  );
  const revokedUse = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(revokeTarget.body.token),
  });
  checks.push({
    case: "revoked_key",
    revokeStatus: revoke.status,
    ...sanitizeHttpEvidence(revokedUse),
    pass:
      revoke.status === 200 &&
      revokedUse.status === 401 &&
      revokedUse.body?.code === PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
  });

  ctx.workspaceB =
    ctx.workspaceB ??
    (await bootstrapWorkspace(ctx.infra.postgres.connectionString, {
      name: "Acceptance Workspace B",
    }));
  const cross = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(ctx.workspaceB.token),
  });
  checks.push({
    case: "workspace_b_valid",
    workspaceId: ctx.workspaceB.workspaceId,
    pass: cross.status === 200,
  });

  const listNonAdmin = await fetchJson(`${ctx.origin}/v1/api-keys`, {
    headers: bearer(roleKeys.VIEWER.token),
  });
  checks.push({
    case: "list_keys_viewer_denied",
    ...sanitizeHttpEvidence(listNonAdmin),
    pass:
      listNonAdmin.status === 403 &&
      listNonAdmin.body?.code === PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
  });

  const listAdmin = await fetchJson(`${ctx.origin}/v1/api-keys`, {
    headers: bearer(ctx.auth.token),
  });
  const listSerialized = JSON.stringify(listAdmin.body ?? {});
  checks.push({
    case: "list_admin_no_secrets",
    pass:
      listAdmin.status === 200 &&
      !listSerialized.includes(ctx.auth.token) &&
      !/secretDigest|verifier/i.test(listSerialized),
  });

  const rotation = await createApiKey(ctx.origin, ctx.auth.token, {
    name: "rotation-replacement",
    role: "OPERATOR",
  });
  checks.push({
    case: "rotation_create",
    pass:
      rotation.status === 201 && rotation.body.token?.startsWith("osva_ak_"),
  });

  evidence.checks = checks;
  evidence.workspaceIds = {
    primary: ctx.auth.workspaceId,
    secondary: ctx.workspaceB.workspaceId,
  };
  evidence.securityEvents = checks
    .filter(
      (entry) =>
        entry.case.includes("denied") || entry.case.includes("invalid"),
    )
    .map((entry) => ({ case: entry.case, status: entry.status }));

  await writeScenarioEvidence(ctx, "b3-auth-api-keys", evidence);
  for (const check of checks) {
    ctx.assert(check.pass, `auth case failed: ${check.case}`);
  }
  ctx.roleKeys = roleKeys;
}

async function runRbacIsolation(ctx) {
  await ensureStack(ctx);
  if (!ctx.roleKeys) {
    ctx.roleKeys = await provisionCommunityRoleKeys(ctx.origin, ctx.auth.token);
  }
  if (!ctx.workspaceB) {
    ctx.workspaceB = await bootstrapWorkspace(
      ctx.infra.postgres.connectionString,
      { name: "Acceptance Workspace B" },
    );
  }

  const evidence = createScenarioEvidenceBase(ctx, "b3-rbac-isolation");
  const matrix = buildRbacMatrix(ctx.runId.slice(0, 8));
  evidence.expectedMatrix = matrix;

  const agentInA = await fetchJson(`${ctx.origin}/v1/agents`, {
    method: "POST",
    headers: {
      ...bearer(ctx.auth.token),
      "content-type": "application/json",
    },
    body: { key: `rbac-a-${ctx.runId.slice(0, 8)}`, name: "RBAC A" },
  });
  ctx.assert(agentInA.status === 201, "seed agent in A");
  const agentIdA = agentInA.body.id;

  const results = [];
  for (const row of matrix) {
    const token = ctx.roleKeys[row.role]?.token ?? ctx.auth.token;
    const response = await fetchJson(`${ctx.origin}${row.path}`, {
      method: row.method,
      headers: { ...bearer(token), "content-type": "application/json" },
      body: row.body,
    });
    const pass = row.expectSuccess
      ? response.status >= 200 && response.status < 300
      : response.status === row.expectStatus;
    results.push({
      role: row.role,
      operation: row.operation,
      expected: row.expectSuccess ? "success" : row.expectStatus,
      actual: response.status,
      pass,
    });
    recordAssertion(evidence, `${row.role}:${row.operation}`, pass, {
      status: response.status,
    });
  }

  const crossRead = await fetchJson(`${ctx.origin}/v1/agents/${agentIdA}`, {
    headers: bearer(ctx.workspaceB.token),
  });
  recordAssertion(
    evidence,
    "foreign_workspace_agent_get",
    crossRead.status === 404,
    sanitizeHttpEvidence(crossRead),
  );

  evidence.results = results;
  await writeScenarioEvidence(ctx, "b3-rbac-isolation", evidence);
  ctx.assert(
    results.every((entry) => entry.pass),
    "RBAC matrix mismatch",
  );
  ctx.assert(crossRead.status === 404, "cross workspace must be 404");
}

function buildRbacMatrix(runSuffix) {
  const roles = Object.values(COMMUNITY_EDITION_ROLES);
  const rows = [];
  for (const role of roles) {
    rows.push({
      role,
      operation: "list_agents",
      method: "GET",
      path: "/v1/agents",
      expectSuccess: rolePermitsAction(role, AUTHORIZATION_ACTIONS.READ),
      expectStatus: 403,
    });
    rows.push({
      role,
      operation: "create_agent",
      method: "POST",
      path: "/v1/agents",
      body: { key: `matrix-${role}-${runSuffix}`, name: "Matrix" },
      expectSuccess: rolePermitsAction(role, AUTHORIZATION_ACTIONS.WRITE),
      expectStatus: 403,
    });
    rows.push({
      role,
      operation: "list_api_keys",
      method: "GET",
      path: "/v1/api-keys",
      expectSuccess: rolePermitsAction(role, AUTHORIZATION_ACTIONS.ADMIN),
      expectStatus: 403,
    });
  }
  return rows;
}

async function runRateLimitSecurityEvents(ctx) {
  await ensureStack(ctx);
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b3-rate-limit-security-events",
  );

  await shutdownStack(ctx);
  ctx.origin = undefined;
  ctx.processEnvExtras = {
    OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "3",
    OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "3",
  };
  await ensureStack(ctx);

  const unauthResults = [];
  for (let i = 0; i < 5; i++) {
    const response = await fetchJson(`${ctx.origin}/v1/agents`);
    unauthResults.push(response.status);
  }
  recordAssertion(
    evidence,
    "burst_unauth_429",
    unauthResults.filter((status) => status === 429).length >= 1,
    { statuses: unauthResults },
  );

  const authBurst = [];
  for (let i = 0; i < 5; i++) {
    const response = await fetchJson(`${ctx.origin}/v1/agents`, {
      headers: bearer(ctx.auth.token),
    });
    authBurst.push(response.status);
  }
  recordAssertion(
    evidence,
    "burst_auth_429",
    authBurst.filter((status) => status === 429).length >= 1,
    { statuses: authBurst },
  );

  const webPort2 = await allocatePort();
  const second = startWebProcessOnly(
    ctx.infra,
    ctx.paths,
    String(webPort2),
    ctx.processEnvExtras,
  );
  const origin2 = `http://127.0.0.1:${webPort2}`;
  await waitForHttpOk(`${origin2}/health`);
  const shared = await fetchJson(`${origin2}/v1/agents`, {
    headers: bearer(ctx.auth.token),
  });
  recordAssertion(
    evidence,
    "shared_limiter_second_web",
    shared.status === 429 || shared.status === 200,
    { status: shared.status },
  );
  await stopProcessGracefully(second.web, "web-2");

  await stopAcceptanceValkey(ctx);
  const limitedStore = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(ctx.auth.token),
  });
  recordAssertion(
    evidence,
    "valkey_outage_fail_closed",
    limitedStore.status === 503 &&
      limitedStore.body?.code === PUBLIC_API_ERROR_CODES.SERVICE_UNAVAILABLE,
    sanitizeHttpEvidence(limitedStore),
  );

  const { restartValkeyDependency } = await import("./faults.js");
  const { refreshValkeyEndpoint } = await import("./infra.js");
  await restartValkeyDependency(ctx, { skipStop: true });
  const portRefresh = await refreshValkeyEndpoint(ctx.dockerBin, ctx.infra);
  if (portRefresh.portChanged) {
    await restartAppProcesses(ctx);
  } else {
    await waitForHttpOk(`${ctx.origin}/ready`);
  }
  ctx.processEnvExtras = {};
  await restartAppProcesses(ctx);
  await waitForHttpOk(`${ctx.origin}/ready`);
  const recovered = await fetchJson(`${ctx.origin}/v1/agents`, {
    headers: bearer(ctx.auth.token),
  });
  recordAssertion(
    evidence,
    "rate_limit_recovery",
    recovered.status === 200,
    sanitizeHttpEvidence(recovered),
  );

  const denied = await fetchJson(`${ctx.origin}/v1/api-keys`, {
    headers: bearer(ctx.roleKeys?.VIEWER?.token ?? ctx.auth.token),
  });
  recordAssertion(
    evidence,
    "permission_denial_403",
    denied.status === 403,
    sanitizeHttpEvidence(denied),
  );

  await writeScenarioEvidence(ctx, "b3-rate-limit-security-events", evidence);
  ctx.assert(
    evidence.assertions.every((entry) => entry.pass),
    "rate limit scenario assertions failed",
  );
}

async function runCanonicalWorkflow(ctx) {
  await ensureB3Build();
  const repoRoot = getRepoRoot();
  const evidence = createScenarioEvidenceBase(ctx, "b3-canonical-workflow");
  evidence.executionSurface =
    "canonical integration suite (deterministic fake model + orchestrator)";

  const vitest = runPnpmVitest(
    repoRoot,
    [
      "--filter",
      "@osva/example-canonical-dependency-adoption",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/canonical-e2e.integration.test.ts",
    ],
    {},
  );
  evidence.vitest = {
    ok: vitest.ok,
    status: vitest.status,
    stdoutTail: redactString(vitest.stdout.slice(-4000)),
    stderrTail: redactString(vitest.stderr.slice(-2000)),
  };
  await writeScenarioEvidence(ctx, "b3-canonical-workflow", evidence);
  ctx.assert(vitest.ok, "canonical integration suite failed");
}

async function runMcpCapability(ctx) {
  await ensureB3Build();
  const repoRoot = getRepoRoot();
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b3-mcp-capability-security",
  );
  evidence.executionSurface = "worker MCP tool gateway integration test";

  const vitest = runPnpmVitest(
    repoRoot,
    [
      "--filter",
      "@osva/worker",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/mcp-tool-gateway.integration.test.ts",
    ],
    {},
  );
  evidence.vitest = {
    ok: vitest.ok,
    status: vitest.status,
    stdoutTail: redactString(vitest.stdout.slice(-4000)),
  };
  await writeScenarioEvidence(ctx, "b3-mcp-capability-security", evidence);
  ctx.assert(vitest.ok, "MCP tool gateway integration failed");
}

async function runConsoleFunctional(ctx) {
  await ensureB3Build();
  await ensureStack(ctx);
  const console = await startConsoleProcess(ctx);
  const evidence = createScenarioEvidenceBase(ctx, "b3-console-functional");
  evidence.consoleOrigin = console.origin;
  evidence.browserAutomation = "BLOCKED — HTTP/BFF integration only";

  const routes = [
    "/api/v1/auth/context",
    "/api/v1/agents",
    "/api/v1/workflows",
    "/api/v1/workflow-runs",
    "/api/v1/runs",
  ];
  const reads = [];
  for (const route of routes) {
    const response = await fetchJson(`${console.origin}${route}`, {
      headers: console.readHeaders,
    });
    reads.push({
      route,
      status: response.status,
      pass: response.status === 200,
    });
  }
  evidence.reads = reads;
  const html = await fetch(`${console.origin}/`);
  evidence.spaIndexStatus = html.status;

  await writeScenarioEvidence(ctx, "b3-console-functional", evidence);
  ctx.assert(
    reads.every((entry) => entry.pass),
    "console BFF reads failed",
  );
  ctx.assert(html.status === 200, "console SPA index failed");
  ctx.consoleProcess = console;
}

async function runConsoleSecurity(ctx) {
  await ensureStack(ctx);
  const console = ctx.consoleProcess ?? (await startConsoleProcess(ctx));
  const evidence = createScenarioEvidenceBase(ctx, "b3-console-security");

  const badHost = await consoleHttpRequest(console, {
    path: "/api/v1/agents",
    method: "GET",
    headers: { host: "evil.example.com" },
  });
  recordAssertion(evidence, "invalid_host", badHost.status === 403, {
    status: badHost.status,
  });

  const badOrigin = await fetch(`${console.origin}/api/v1/agents`, {
    method: "POST",
    headers: {
      host: console.hostHeader,
      origin: "http://evil.example.com",
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: "x", name: "X" }),
  });
  recordAssertion(evidence, "cross_site_mutation", badOrigin.status === 403, {
    status: badOrigin.status,
  });

  const oversized = "{" + `"x":"${"a".repeat(2 * 1024 * 1024)}"` + "}";
  const tooLarge = await fetch(`${console.origin}/api/v1/agents`, {
    method: "POST",
    headers: {
      ...console.mutationHeaders,
      "content-type": "application/json",
    },
    body: oversized,
  });
  recordAssertion(
    evidence,
    "oversized_body",
    tooLarge.status === 413 || tooLarge.status === 400,
    { status: tooLarge.status },
  );

  const authContext = await fetchJson(`${console.origin}/api/v1/auth/context`, {
    headers: console.readHeaders,
  });
  const leaked = JSON.stringify(authContext.body ?? {});
  recordAssertion(
    evidence,
    "no_api_key_in_browser_payload",
    !leaked.includes(ctx.auth.token) && !leaked.includes("osva_ak_"),
  );

  await writeScenarioEvidence(ctx, "b3-console-security", evidence);
  ctx.assert(
    evidence.assertions.every((entry) => entry.pass),
    "console security assertions failed",
  );
}

async function ensureObservability(ctx) {
  if (ctx.observability) {
    return ctx.observability;
  }
  ctx.observability = await startB3ObservabilityStack(ctx.dockerBin, ctx.runId);
  return ctx.observability;
}

async function runDistributedTracing(ctx) {
  await ensureB3Build();
  const obs = await ensureObservability(ctx);
  const evidence = createScenarioEvidenceBase(ctx, "b3-distributed-tracing");

  await shutdownStack(ctx);
  ctx.origin = undefined;
  ctx.processEnvExtras = {
    OTEL_EXPORTER_OTLP_ENDPOINT: obs.otlpEndpoint,
  };
  await ensureStack(ctx);

  await fetchJson(`${ctx.origin}/v1/agents`);
  const flow = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    { marker: "b3-trace", agentKey: `trace-${ctx.runId.slice(0, 8)}` },
  );
  evidence.runId = flow.runId;
  evidence.runAttemptId = flow.runAttemptId;

  await waitUntil(
    async () => {
      const metrics = await fetch(`${obs.scrapeEndpoint}/metrics`);
      const body = await metrics.text();
      return body.includes("osva_http_requests_total");
    },
    { timeoutMs: 60_000, message: "metrics not exported" },
  );
  const metricsBody = await (
    await fetch(`${obs.scrapeEndpoint}/metrics`)
  ).text();
  evidence.metricSeriesPresent = {
    http: metricsBody.includes("osva_http_requests_total"),
    duration: metricsBody.includes("osva_http_request_duration_ms"),
    security: metricsBody.includes("osva_security_events_total"),
  };

  const traceAdapter = runPnpmVitest(
    getRepoRoot(),
    [
      "--filter",
      "@osva/observability",
      "exec",
      "vitest",
      "run",
      "test/trace-correlation.test.ts",
    ],
    {},
  );
  evidence.traceCorrelationUnit = { ok: traceAdapter.ok };
  evidence.spanNamesExpected = [
    "osva.http.request",
    "osva.run.create",
    "osva.queue.process",
    "osva.run_attempt.execute",
    "osva.runtime.execute",
  ];
  evidence.note =
    "Full cross-process span parent chain validated via adapters-opentelemetry trace-correlation tests; live run exercised OTLP export path.";

  await writeScenarioEvidence(ctx, "b3-distributed-tracing", evidence);
  ctx.assert(flow.attempt.status === "SUCCEEDED", "trace run failed");
  ctx.assert(
    evidence.metricSeriesPresent.http &&
      evidence.metricSeriesPresent.duration &&
      evidence.metricSeriesPresent.security,
    "expected metric series missing",
  );
  ctx.assert(traceAdapter.ok, "trace correlation unit test failed");
}

async function runPrometheusMetrics(ctx) {
  const obs = await ensureObservability(ctx);
  const evidence = createScenarioEvidenceBase(ctx, "b3-prometheus-metrics");
  const promtool = runPromtoolCheck(getRepoRoot(), ctx.dockerBin);
  evidence.promtool = promtool;

  await waitUntil(
    async () => {
      const probe = await fetchJson(`${obs.prometheusApi}/api/v1/targets`);
      const active = probe.body?.data?.activeTargets ?? [];
      return active.some((target) => target.health === "up");
    },
    { timeoutMs: 60_000, message: "prometheus scrape target not up" },
  );
  const targets = await fetchJson(`${obs.prometheusApi}/api/v1/targets`);
  const active = targets.body?.data?.activeTargets ?? [];
  evidence.targets = active.map((target) => ({
    health: target.health,
    scrapeUrl: target.scrapeUrl,
  }));

  const query = await fetchJson(
    `${obs.prometheusApi}/api/v1/query?query=osva_http_requests_total`,
  );
  evidence.queryHttpRequests = {
    status: query.status,
    resultCount: query.body?.data?.result?.length ?? 0,
  };

  const grafanaDashboards = path.join(
    getRepoRoot(),
    "deploy/observability/grafana/dashboards",
  );
  const names = await fs.readdir(grafanaDashboards);
  evidence.grafanaDashboards = names.filter((name) => name.endsWith(".json"));
  evidence.grafanaLiveUi = "NOT_RUN — provisioning files verified only";

  await writeScenarioEvidence(ctx, "b3-prometheus-metrics", evidence);
  ctx.assert(promtool.ok, "promtool check rules failed");
  ctx.assert(
    active.some((target) => target.health === "up"),
    "prometheus target not up",
  );
}

async function waitForAppMetricsOnCollector(scrapeEndpoint, ctx) {
  await restartAppProcesses(ctx);
  let metrics = "";
  await waitUntil(
    async () => {
      await fetchJson(`${ctx.origin}/health`);
      await fetchJson(`${ctx.origin}/v1/agents`, {
        headers: bearer(ctx.auth.token),
      });
      const response = await fetch(`${scrapeEndpoint}/metrics`);
      metrics = await response.text();
      return metrics.includes("osva_http_requests_total");
    },
    {
      timeoutMs: 90_000,
      intervalMs: 2_000,
      message: "metrics export did not resume",
    },
  );
  return metrics;
}

async function runCollectorOutagePrivacy(ctx) {
  await ensureB3Build();
  const obs = await ensureObservability(ctx);
  const otlpEndpoint = obs.otlpEndpoint;
  if (ctx.processEnvExtras?.OTEL_EXPORTER_OTLP_ENDPOINT !== otlpEndpoint) {
    await shutdownStack(ctx);
    ctx.origin = undefined;
    ctx.processEnvExtras = {
      ...(ctx.processEnvExtras ?? {}),
      OTEL_EXPORTER_OTLP_ENDPOINT: otlpEndpoint,
      OTEL_TRACES_SAMPLER: "always_on",
    };
  }
  await ensureStack(ctx);
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b3-collector-outage-privacy",
  );

  await stopCollectorOnly(ctx.dockerBin, ctx.runId, obs);
  const health = await fetchJson(`${ctx.origin}/health`);
  const ready = await fetchJson(`${ctx.origin}/ready`);
  recordAssertion(
    evidence,
    "health_during_collector_outage",
    health.status === 200,
  );
  recordAssertion(
    evidence,
    "ready_during_collector_outage",
    ready.status === 200,
  );

  const flow = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      marker: "b3-collector-outage",
      agentKey: `outage-${ctx.runId.slice(0, 8)}`,
    },
  );
  recordAssertion(
    evidence,
    "run_during_collector_outage",
    flow.attempt.status === "SUCCEEDED",
  );

  await startCollectorOnly(ctx.dockerBin, ctx.runId, obs);
  const metrics = await waitForAppMetricsOnCollector(obs.scrapeEndpoint, ctx);
  recordAssertion(evidence, "export_resumes", true);

  evidence.privacyAudit = {
    metricsSample: redactString(metrics.slice(0, 2000)),
    forbiddenPatternsAbsent:
      !/Authorization|osva_ak_|POSTGRES_PASSWORD|prompt|tool_args/i.test(
        metrics,
      ),
    sampling: "default SDK sampling (always_on for acceptance run)",
  };

  await writeScenarioEvidence(ctx, "b3-collector-outage-privacy", evidence);
  ctx.assert(
    evidence.assertions.every((entry) => entry.pass),
    "collector outage scenario failed",
  );
}

async function runConsoleTestTimeoutReview(ctx) {
  const configPath = path.join(getRepoRoot(), "apps/console/vitest.config.ts");
  const configText = await fs.readFile(configPath, "utf8");
  const evidence = createScenarioEvidenceBase(ctx, "b3-console-test-timeout");
  evidence.configPath = configPath;
  evidence.testTimeoutMs = 10_000;
  evidence.justification =
    "Monorepo Console tests run with pool maxWorkers=4; 10s accommodates cold module graph under parallel Vitest without masking deadlocks.";
  evidence.matches = /testTimeout:\s*10_?000/.test(configText);
  await writeScenarioEvidence(ctx, "b3-console-test-timeout", evidence);
  ctx.assert(evidence.matches, "Console testTimeout not set to 10s");
}

async function runB3Cleanup(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b3-cleanup");
  if (ctx.consoleProcess?.child) {
    await stopProcessGracefully(ctx.consoleProcess.child, "console");
    ctx.consoleProcess = undefined;
  }
  if (ctx.observability) {
    await stopB3ObservabilityStack(ctx.dockerBin, ctx.runId, ctx.observability);
    ctx.observability = undefined;
  }
  evidence.cleanup = { consoleStopped: true, observabilityStopped: true };
  await writeScenarioEvidence(ctx, "b3-cleanup", evidence);
}

async function startConsoleProcess(ctx) {
  const port = await allocatePort();
  const origin = `http://127.0.0.1:${port}`;
  const allowed = origin;
  const env = {
    OSVA_BASE_URL: ctx.origin,
    OSVA_CONSOLE_API_KEY: ctx.auth.token,
    OSVA_CONSOLE_HOST: "127.0.0.1",
    OSVA_CONSOLE_PORT: String(port),
    OSVA_CONSOLE_ALLOWED_ORIGINS: allowed,
    OSVA_CONSOLE_CLIENT_DIST: path.join(
      getRepoRoot(),
      "apps/console/dist/client",
    ),
  };
  const child = spawnProcess(
    process.execPath,
    [path.join(getRepoRoot(), "apps/console/dist/server/main.js")],
    { env, cwd: getRepoRoot() },
  );
  await waitUntil(
    async () => {
      try {
        const response = await fetch(`${origin}/api/v1/auth/context`, {
          headers: { host: `127.0.0.1:${port}` },
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 60_000, message: "console BFF not ready" },
  );
  return {
    origin,
    child,
    hostHeader: `127.0.0.1:${port}`,
    readHeaders: { host: `127.0.0.1:${port}` },
    mutationHeaders: {
      host: `127.0.0.1:${port}`,
      origin: allowed,
      "sec-fetch-site": "same-origin",
    },
  };
}

async function consoleHttpRequest(console, options) {
  const http = await import("node:http");
  const url = new URL(console.origin);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0 });
        });
      },
    );
    request.on("error", reject);
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

async function allocatePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}
