/**
 * M15.4 adoption acceptance steps — orchestration only; tests live in existing suites.
 *
 * @typedef {"default" | "integration" | "browser" | "full"} AcceptanceProfile
 * @typedef {"bootstrap" | "model-connector" | "agent-execution" | "workflow" | "evaluation" | "operator" | "security" | "rc4"} AcceptanceGroup
 *
 * @typedef {object} AcceptanceStep
 * @property {string} id
 * @property {AcceptanceGroup} group
 * @property {string} journey Letter from M15.4 matrix (A–G) or "RC4"
 * @property {string} title
 * @property {readonly AcceptanceProfile[]} profiles
 * @property {boolean} requiresDocker
 * @property {boolean} requiresBrowser
 * @property {readonly string[]} commandArgv
 * @property {string} command Human-readable command
 * @property {string} reuseNote Existing test or harness reused
 */

/** @type {readonly AcceptanceStep[]} */
export const M15_4_STEPS = [
  // —— RC4 / bootstrap (A) ——
  {
    id: "rc4-version-alignment",
    group: "bootstrap",
    journey: "RC4",
    title: "VERSION, npm, Python, and Helm alignment (1.1.0-rc.4)",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: ["pnpm", "release:version:check"],
    command: "pnpm release:version:check",
    reuseNote:
      "scripts/release/version-consistency.mjs (release:acceptance subset)",
  },
  {
    id: "migration-history-verify",
    group: "bootstrap",
    journey: "A",
    title: "Locked Drizzle migration manifest through head 0030",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: ["pnpm", "db:migrations:verify"],
    command: "pnpm db:migrations:verify",
    reuseNote: "packages/db migrations:verify (verify:ci / release:acceptance)",
  },
  {
    id: "deploy-compose-config",
    group: "bootstrap",
    journey: "A",
    title: "Compose deployment configuration validation",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      process.execPath,
      "--test",
      "scripts/verification/deploy-compose-config.test.mjs",
    ],
    command: "node --test scripts/verification/deploy-compose-config.test.mjs",
    reuseNote: "scripts/verification/deploy-compose-config.test.mjs",
  },
  {
    id: "hello-agent-config-wiring",
    group: "bootstrap",
    journey: "A",
    title: "Hello Agent required configuration inventory",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      process.execPath,
      "--test",
      "scripts/verification/hello-agent-onboarding.test.mjs",
    ],
    command: "node --test scripts/verification/hello-agent-onboarding.test.mjs",
    reuseNote: "scripts/verification/hello-agent-onboarding.test.mjs",
  },
  {
    id: "npm-pack-smoke",
    group: "rc4",
    journey: "RC4",
    title: "Packed npm manifests (no workspace/catalog leaks)",
    profiles: ["default", "integration", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [process.execPath, "scripts/release/npm-pack-smoke.mjs"],
    command: "node scripts/release/npm-pack-smoke.mjs",
    reuseNote: "scripts/release/npm-pack-smoke.mjs (release:acceptance)",
  },
  {
    id: "rc4-registry-npm",
    group: "rc4",
    journey: "RC4",
    title: "Published @osva-ai/* @rc registry versions (optional network)",
    profiles: ["full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      process.execPath,
      "scripts/acceptance/m15-4/lib/rc4-registry-check.mjs",
    ],
    command: "node scripts/acceptance/m15-4/lib/rc4-registry-check.mjs",
    reuseNote:
      "RC4_VERIFICATION.md npm evidence; NOT_RUN when registry unreachable",
  },
  {
    id: "human-session-integration",
    group: "bootstrap",
    journey: "A",
    title: "Console human-session BFF integration (bootstrap + auth)",
    profiles: ["integration", "full"],
    requiresDocker: true,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/console-human-session.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run --config vitest.integration.config.ts test/integration/console-human-session.integration.test.ts",
    reuseNote:
      "apps/console/test/integration/console-human-session.integration.test.ts",
  },

  // —— Model & connector (B) + agent execution (C) ——
  {
    id: "m12-3-cross-capability",
    group: "model-connector",
    journey: "B",
    title:
      "M12.3 cross-capability (fake model, MCP, ToolGateway, human session)",
    profiles: ["integration", "full"],
    requiresDocker: true,
    requiresBrowser: false,
    commandArgv: [process.execPath, "scripts/acceptance/m12-3/run.mjs"],
    command: "pnpm acceptance:m12-3",
    reuseNote:
      "apps/console/test/integration/m12-3-cross-capability.integration.test.ts",
  },
  {
    id: "worker-integration",
    group: "agent-execution",
    journey: "C",
    title: "Worker queue consumption and RunAttempt persistence",
    profiles: ["integration", "full"],
    requiresDocker: true,
    requiresBrowser: false,
    commandArgv: ["pnpm", "--filter", "@osva/worker", "test:integration"],
    command: "pnpm --filter @osva/worker test:integration",
    reuseNote: "apps/worker test:integration",
  },

  // —— Workflow (D) ——
  {
    id: "canonical-adoption-integration",
    group: "workflow",
    journey: "D",
    title: "Canonical dependency adoption E2E (approval, event wait, workflow)",
    profiles: ["integration", "full"],
    requiresDocker: true,
    requiresBrowser: false,
    commandArgv: ["pnpm", "canonical:test:integration"],
    command: "pnpm canonical:test:integration",
    reuseNote:
      "examples/canonical-dependency-adoption/test/integration/canonical-e2e.integration.test.ts",
  },

  // —— Evaluation (E) ——
  {
    id: "evaluation-quality-gate-unit",
    group: "evaluation",
    journey: "E",
    title: "Evaluation quality-gate domain and Console unit coverage",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "test/evaluation-run-launch-gate.test.tsx",
      "test/evaluation-run-detail-gate.test.tsx",
      "test/evaluation-quality-gate-config.test.ts",
      "test/evaluation-quality-gate-display.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run test/evaluation-run-launch-gate.test.tsx test/evaluation-run-detail-gate.test.tsx …",
    reuseNote: "M13.7.5 / M15.2 unit tests (not browser fixtures)",
  },
  {
    id: "evaluation-runs-http-isolation",
    group: "evaluation",
    journey: "E",
    title: "Evaluation run REST authorization boundaries",
    profiles: ["default", "integration", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/web",
      "exec",
      "vitest",
      "run",
      "test/evaluation-runs-http.test.ts",
    ],
    command:
      "pnpm --filter @osva/web exec vitest run test/evaluation-runs-http.test.ts",
    reuseNote: "apps/web/test/evaluation-runs-http.test.ts (M13.7.5)",
  },
  {
    id: "m13-7-5-browser",
    group: "evaluation",
    journey: "E",
    title: "Evaluation Studio quality-gate browser acceptance",
    profiles: ["browser", "full"],
    requiresDocker: true,
    requiresBrowser: true,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.browser.config.ts",
      "test/integration/m13-7-5-browser.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-7-5-browser.integration.test.ts",
    reuseNote:
      "apps/console/test/integration/m13-7-5-browser.integration.test.ts (M15.2)",
  },

  // —— Operator diagnostics (F) ——
  {
    id: "operator-diagnostics-unit",
    group: "operator",
    journey: "F",
    title: "M15.3 operator diagnostics and error presentation",
    profiles: ["default", "integration", "browser", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "test/operator-diagnostics.test.ts",
      "test/error-state.test.tsx",
      "test/run-detail-page.test.tsx",
      "test/workflow-run-detail.test.tsx",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run test/operator-diagnostics.test.ts test/error-state.test.tsx …",
    reuseNote: "M15.3 focused Console unit tests",
  },

  // —— Security regression (G) ——
  {
    id: "m14-adversarial-acceptance",
    group: "security",
    journey: "G",
    title: "M14.4 adversarial ToolGateway and declarative runtime scenarios",
    profiles: ["default", "integration", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: ["pnpm", "--filter", "@osva/adversarial-acceptance", "test"],
    command: "pnpm --filter @osva/adversarial-acceptance test",
    reuseNote:
      "packages/adversarial-acceptance/test/m14-4-adversarial-acceptance.test.ts",
  },
  {
    id: "m14-human-and-isolation-http",
    group: "security",
    journey: "G",
    title: "Human-session security and REST workspace isolation",
    profiles: ["default", "integration", "full"],
    requiresDocker: false,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/web",
      "exec",
      "vitest",
      "run",
      "test/m14-2-human-security-http.test.ts",
      "test/rest-workspace-isolation.test.ts",
      "test/workflow-event-workspace-isolation.test.ts",
    ],
    command:
      "pnpm --filter @osva/web exec vitest run test/m14-2-human-security-http.test.ts …",
    reuseNote: "M14.2 / M14 cross-workspace HTTP matrix",
  },
  {
    id: "approval-binding-db-integration",
    group: "security",
    journey: "G",
    title: "Approval operation binding persistence (migration 0030)",
    profiles: ["integration", "full"],
    requiresDocker: true,
    requiresBrowser: false,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/db",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/approval-requests.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/db exec vitest run --config vitest.integration.config.ts test/integration/approval-requests.integration.test.ts",
    reuseNote:
      "packages/db/test/integration/approval-requests.integration.test.ts",
  },

  // —— Browser adoption journeys ——
  {
    id: "m12-3-browser",
    group: "bootstrap",
    journey: "A",
    title: "M12.3 human-session Console browser smoke",
    profiles: ["browser", "full"],
    requiresDocker: true,
    requiresBrowser: true,
    commandArgv: [
      process.execPath,
      "scripts/acceptance/m12-3/run.mjs",
      "--browser-only",
    ],
    command: "pnpm acceptance:m12-3:browser-ci",
    reuseNote:
      "apps/console/test/integration/m12-3-browser.integration.test.ts",
  },
  {
    id: "m13-4-onboarding-browser",
    group: "bootstrap",
    journey: "A",
    title: "Console onboarding and workspace shell browser smoke",
    profiles: ["browser", "full"],
    requiresDocker: true,
    requiresBrowser: true,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.browser.config.ts",
      "test/integration/m13-4-browser.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-4-browser.integration.test.ts",
    reuseNote:
      "apps/console/test/integration/m13-4-browser.integration.test.ts",
  },
  {
    id: "m13-3-agent-studio-browser",
    group: "agent-execution",
    journey: "C",
    title: "No-code Agent Studio declarative browser journey",
    profiles: ["browser", "full"],
    requiresDocker: true,
    requiresBrowser: true,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.browser.config.ts",
      "test/integration/m13-3-browser.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-3-browser.integration.test.ts",
    reuseNote:
      "apps/console/test/integration/m13-3-browser.integration.test.ts",
  },
  {
    id: "m13-6-workflow-browser",
    group: "workflow",
    journey: "D",
    title: "Workflow Studio publish and AGENT node browser journey",
    profiles: ["browser", "full"],
    requiresDocker: true,
    requiresBrowser: true,
    commandArgv: [
      "pnpm",
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.browser.config.ts",
      "test/integration/m13-6-browser.integration.test.ts",
    ],
    command:
      "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-6-browser.integration.test.ts",
    reuseNote:
      "apps/console/test/integration/m13-6-browser.integration.test.ts",
  },
];

/**
 * @param {AcceptanceProfile} profile
 * @param {AcceptanceGroup | undefined} groupFilter
 * @returns {AcceptanceStep[]}
 */
export function resolveSteps(profile, groupFilter) {
  let steps = M15_4_STEPS.filter((step) => step.profiles.includes(profile));
  if (groupFilter) {
    steps = steps.filter((step) => step.group === groupFilter);
  }
  return [...steps];
}

/**
 * @returns {{ id: AcceptanceGroup, label: string }[]}
 */
export function listGroups() {
  return [
    { id: "bootstrap", label: "A — Installation and bootstrap" },
    { id: "model-connector", label: "B — Model and connector configuration" },
    { id: "agent-execution", label: "C — Agent creation and execution" },
    { id: "workflow", label: "D — Workflow operations" },
    { id: "evaluation", label: "E — Evaluation Studio" },
    { id: "operator", label: "F — Operator diagnostics" },
    { id: "security", label: "G — Security regression" },
    { id: "rc4", label: "RC4 compatibility evidence" },
  ];
}
