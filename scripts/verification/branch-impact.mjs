import path from "node:path";

import {
  affectedPackages,
  isPrettierPath,
  loadWorkspacePackages,
} from "./changed-files.mjs";
import {
  directConsumerPackages,
  loadWorkspaceManifests,
} from "./workspace-graph.mjs";

/** @typedef {"fast" | "integration"} VerificationProfile */

/**
 * @typedef {object} TargetedUnitTest
 * @property {string} packageName
 * @property {string} label
 * @property {string[]} relativeTestFiles
 */

/**
 * @typedef {object} IntegrationObligation
 * @property {string} id
 * @property {string} label
 * @property {readonly string[]} commandArgv
 * @property {string} command
 * @property {string} reason
 * @property {boolean} runInIntegrationProfile
 * @property {boolean} requiresDocker
 */

const AREA_RULE_IDS = new Set([
  "console-routes",
  "console-package",
  "agent-studio",
  "console-bff-client",
  "runtime-adapter",
  "adapter-surface",
  "runtime-composition",
  "auth-contracts",
  "contracts-schemas",
  "knowledge-memory",
  "browser-harness",
  "evaluation-studio",
  "operator-diagnostics",
  "db-migrations",
  "compose-deploy",
  "documentation",
  "verification-harness",
  "app-surface",
  "library-surface",
]);

/**
 * @typedef {object} VerificationPlan
 * @property {readonly string[]} changedPaths
 * @property {readonly string[]} prettierPaths
 * @property {readonly string[]} turboPackageNames
 * @property {readonly string[]} consumerPackageNames
 * @property {readonly TargetedUnitTest[]} targetedUnitTests
 * @property {readonly IntegrationObligation[]} obligations
 * @property {readonly string[]} impactSummary
 * @property {readonly string[]} unknownSourcePaths
 * @property {boolean} docsLinkCheck
 * @property {boolean} migrationIntegrity
 * @property {boolean} runHarnessTests
 * @property {boolean} globalTurbo
 */

/**
 * @param {string} file
 * @returns {boolean}
 */
function isTypeScriptSource(file) {
  return /\.(tsx?|mts|cts)$/.test(file);
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isTestPath(file) {
  return (
    file.includes("/test/") ||
    file.includes("\\test\\") ||
    /\.(test|spec)\.(tsx?|mts|cts)$/.test(file)
  );
}

/**
 * @param {string} file
 * @param {readonly string[]} prefixes
 */
function startsWithAny(file, prefixes) {
  const normalized = file.split(path.sep).join("/");
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

/**
 * @param {readonly string[]} paths
 * @param {readonly { dir: string, name: string }[]} packages
 */
function matchRules(paths, packages) {
  /** @type {Set<string>} */
  const matchedSpecific = new Set();
  /** @type {string[]} */
  const summary = [];

  const note = (id, detail) => {
    matchedSpecific.add(id);
    summary.push(`${id}: ${detail}`);
  };

  for (const file of paths) {
    const normalized = file.split(path.sep).join("/");
    for (const pkg of packages) {
      if (normalized === pkg.dir || normalized.startsWith(`${pkg.dir}/`)) {
        note(`package:${pkg.name}`, normalized);
      }
    }
    if (normalized.startsWith("apps/console/")) {
      note("console-package", normalized);
    }
    if (
      normalized.startsWith("apps/console/src/client/routes/") ||
      normalized === "apps/console/src/client/app-router.tsx" ||
      normalized.startsWith("apps/console/src/client/navigation") ||
      normalized.includes("/agent-onboarding") ||
      normalized.includes("/workspace-setup-guidance")
    ) {
      note("console-routes", normalized);
    }
    if (normalized.startsWith("apps/")) {
      note("app-surface", normalized);
    }
    if (normalized.startsWith("packages/")) {
      note("library-surface", normalized);
    }
    if (normalized.startsWith("adapters/")) {
      note("adapter-surface", normalized);
    }
    if (
      normalized.includes("/components/agent/declarative-agent-studio") ||
      normalized.includes("/routes/agent-create") ||
      normalized.includes("/routes/agent-version-create")
    ) {
      note("agent-studio", normalized);
    }
    if (
      normalized === "apps/console/src/server/osva-client.ts" ||
      normalized === "apps/console/src/server/human-session-osva-client.ts" ||
      normalized.startsWith("apps/console/src/server/routes/")
    ) {
      note("console-bff-client", normalized);
    }
    if (normalized.startsWith("adapters/runtime-")) {
      note("runtime-adapter", normalized);
    }
    if (
      normalized.startsWith("apps/worker/src/") ||
      normalized.includes("runtime-composition")
    ) {
      note("runtime-composition", normalized);
    }
    if (
      normalized.startsWith("packages/contracts/") ||
      normalized.startsWith("packages/domain/") ||
      normalized.includes("adapters-auth") ||
      normalized.includes("/auth/")
    ) {
      note("auth-contracts", normalized);
    }
    if (
      normalized.startsWith("packages/contracts/") ||
      normalized.endsWith(".schema.json") ||
      normalized.includes("/contracts/")
    ) {
      note("contracts-schemas", normalized);
    }
    if (
      normalized.includes("knowledge") ||
      normalized.includes("memory-gateway") ||
      normalized.startsWith("adapters/memory/") ||
      normalized.startsWith("apps/knowledge-worker/")
    ) {
      note("knowledge-memory", normalized);
    }
    if (
      normalized.includes("browser.integration.test") ||
      normalized.includes("ensure-console-client-dist") ||
      normalized.startsWith("scripts/acceptance/")
    ) {
      note("browser-harness", normalized);
    }
    if (
      normalized.includes("operator-diagnostics.ts") ||
      normalized.includes("operator-guidance.tsx") ||
      normalized.includes("routes/run-detail-page.tsx") ||
      normalized.includes("routes/workflow-run-detail-page.tsx") ||
      normalized.includes("routes/connector-detail-page.tsx") ||
      normalized.includes("routes/model-connection-detail-page.tsx") ||
      normalized.includes("routes/knowledge-source-page.tsx") ||
      normalized.includes("components/error-state/error-state.tsx")
    ) {
      note("operator-diagnostics", normalized);
    }
    if (
      normalized.startsWith("apps/console/src/client/components/evaluation/") ||
      normalized.startsWith("apps/console/src/client/routes/evaluation-") ||
      normalized.includes("evaluation-quality-gate") ||
      normalized.includes("evaluation-run-launch") ||
      normalized.includes("evaluation-run-detail") ||
      normalized.includes("use-evaluations.ts") ||
      normalized.includes("m13-7-5-browser")
    ) {
      note("evaluation-studio", normalized);
    }
    if (
      normalized.startsWith("packages/db/drizzle/") ||
      normalized.startsWith("packages/db/migrations/") ||
      normalized.includes("migrations/")
    ) {
      note("db-migrations", normalized);
    }
    if (
      normalized.startsWith("deploy/compose/") ||
      normalized.startsWith("deploy/helm/") ||
      normalized.startsWith("scripts/deployment/")
    ) {
      note("compose-deploy", normalized);
    }
    if (
      normalized.startsWith("docs/") ||
      normalized.endsWith(".md") ||
      normalized.endsWith(".mdx")
    ) {
      note("documentation", normalized);
    }
    if (
      normalized.startsWith("scripts/verification/") &&
      !normalized.endsWith(".test.mjs")
    ) {
      note("verification-harness", normalized);
    }
  }

  return { matchedSpecific, summary: [...new Set(summary)].sort() };
}

/**
 * @param {readonly string[]} paths
 * @param {readonly { dir: string, name: string }[]} packages
 */
function unknownSourcePaths(paths, packages) {
  /** @type {string[]} */
  const unknown = [];
  for (const file of paths) {
    if (!isTypeScriptSource(file) || isTestPath(file)) {
      continue;
    }
    const normalized = file.split(path.sep).join("/");
    if (
      normalized.startsWith("scripts/") ||
      normalized.startsWith("sdks/") ||
      normalized.includes("/dist/")
    ) {
      continue;
    }
    const inProductTree = packages.some(
      (pkg) => normalized === pkg.dir || normalized.startsWith(`${pkg.dir}/`),
    );
    if (!inProductTree) {
      unknown.push(normalized);
      continue;
    }
    const { matchedSpecific } = matchRules([normalized], packages);
    const hasAreaRule = [...matchedSpecific].some((id) =>
      AREA_RULE_IDS.has(id),
    );
    if (!hasAreaRule) {
      unknown.push(normalized);
    }
  }
  return [...new Set(unknown)].sort();
}

/**
 * @param {readonly string[]} paths
 * @param {{ profile?: VerificationProfile }} [options]
 * @returns {Promise<VerificationPlan>}
 */
export async function buildVerificationPlan(paths, options = {}) {
  const profile = options.profile ?? "fast";
  void profile;

  const packages = await loadWorkspacePackages();
  const manifests = await loadWorkspaceManifests();
  const affected = affectedPackages(paths, packages);
  const { matchedSpecific, summary } = matchRules(paths, packages);

  /** @type {Set<string>} */
  const turboNames = new Set(affected.names);

  if (matchedSpecific.has("runtime-adapter")) {
    turboNames.add("@osva/worker");
    for (const manifest of manifests) {
      if (manifest.dir.startsWith("adapters/runtime-")) {
        const touched = paths.some(
          (file) =>
            file.split(path.sep).join("/").startsWith(`${manifest.dir}/`) ||
            file.split(path.sep).join("/") === manifest.dir,
        );
        if (touched) {
          turboNames.add(manifest.name);
        }
      }
    }
  }

  if (matchedSpecific.has("console-bff-client")) {
    turboNames.add("@osva/console");
  }

  if (matchedSpecific.has("contracts-schemas")) {
    for (const name of directConsumerPackages(
      [...turboNames].filter((n) => n.startsWith("@osva")),
      manifests,
    )) {
      turboNames.add(name);
    }
    turboNames.add("@osva-ai/contracts");
  }

  const consumerNames = directConsumerPackages([...turboNames], manifests);

  /** @type {TargetedUnitTest[]} */
  const targeted = [];

  if (matchedSpecific.has("console-routes")) {
    targeted.push({
      packageName: "@osva/console",
      label: "Console navigation and route regression",
      relativeTestFiles: [
        "test/spa-routing.test.ts",
        "test/agent-onboarding.test.ts",
      ],
    });
  }

  if (matchedSpecific.has("agent-studio")) {
    targeted.push({
      packageName: "@osva/console",
      label: "Agent manifest and binding tests",
      relativeTestFiles: [
        "test/declarative-agent-manifest.test.ts",
        "test/agent-tool-bindings.test.ts",
        "test/workflow-builder-agent-bindings.test.ts",
        "test/agent-studio.test.tsx",
      ],
    });
  }

  if (matchedSpecific.has("console-bff-client")) {
    targeted.push({
      packageName: "@osva/console",
      label: "Console BFF and human-session client",
      relativeTestFiles: [
        "test/human-session-bff.test.ts",
        "test/server.test.ts",
        "test/console-api.test.ts",
      ],
    });
  }

  if (matchedSpecific.has("auth-contracts")) {
    targeted.push({
      packageName: "@osva/console",
      label: "Authorization negative-path regression",
      relativeTestFiles: [
        "test/human-role-mutation-matrix.test.ts",
        "test/console-security-events.test.ts",
        "test/request-guard.test.ts",
      ],
    });
  }

  if (matchedSpecific.has("knowledge-memory")) {
    targeted.push({
      packageName: "@osva/console",
      label: "Knowledge and memory bindings",
      relativeTestFiles: ["test/agent-knowledge-bindings.test.ts"],
    });
  }

  /** @type {IntegrationObligation[]} */
  const obligations = [];

  const addObligation = (entry) => {
    if (!obligations.some((item) => item.id === entry.id)) {
      obligations.push(entry);
    }
  };

  if (matchedSpecific.has("runtime-composition")) {
    addObligation({
      id: "worker-integration",
      label: "Worker runtime composition integration",
      commandArgv: ["pnpm", "--filter", "@osva/worker", "test:integration"],
      command: "pnpm --filter @osva/worker test:integration",
      reason:
        "Runtime composition changes require worker integration evidence.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  if (matchedSpecific.has("knowledge-memory")) {
    addObligation({
      id: "knowledge-integration",
      label: "Knowledge/memory integration",
      commandArgv: [
        "pnpm",
        "--filter",
        "@osva/knowledge-worker",
        "test:integration",
      ],
      command: "pnpm --filter @osva/knowledge-worker test:integration",
      reason:
        "Knowledge or memory surface changes require integration coverage.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  if (matchedSpecific.has("operator-diagnostics")) {
    targeted.push({
      packageName: "@osva/console",
      label: "M15.3 operator diagnostics",
      relativeTestFiles: [
        "test/operator-diagnostics.test.ts",
        "test/error-state.test.tsx",
        "test/run-detail-page.test.tsx",
        "test/workflow-run-detail.test.tsx",
      ],
    });
  }

  if (matchedSpecific.has("evaluation-studio")) {
    addObligation({
      id: "console-evaluation-quality-gate-browser",
      label: "Evaluation Studio quality-gate browser acceptance",
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
      reason:
        "Evaluation Studio or quality-gate UI changes require M13.7.5 browser acceptance.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  if (matchedSpecific.has("console-routes")) {
    addObligation({
      id: "console-m16-3-browser",
      label: "M16.3 first-agent onboarding browser acceptance",
      commandArgv: [
        "pnpm",
        "--filter",
        "@osva/console",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.browser.config.ts",
        "test/integration/m16-3-browser.integration.test.ts",
      ],
      command:
        "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m16-3-browser.integration.test.ts",
      reason:
        "Onboarding or first-agent Console journey changes require M16.3 browser acceptance.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  if (
    matchedSpecific.has("browser-harness") ||
    matchedSpecific.has("console-routes")
  ) {
    addObligation({
      id: "console-browser-smoke",
      label: "Console browser acceptance smoke",
      commandArgv: [
        "pnpm",
        "--filter",
        "@osva/console",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.browser.config.ts",
        "test/integration/m13-5-browser.integration.test.ts",
        "test/integration/m13-6-browser.integration.test.ts",
      ],
      command:
        "pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-6-browser.integration.test.ts",
      reason:
        "Browser harness or Console route changes require a fresh client build and browser smoke.",
      runInIntegrationProfile: true,
      requiresDocker: false,
    });
  }

  if (matchedSpecific.has("db-migrations")) {
    addObligation({
      id: "db-integration",
      label: "Database integration",
      commandArgv: ["pnpm", "--filter", "@osva/db", "test:integration"],
      command: "pnpm --filter @osva/db test:integration",
      reason: "Migration changes require database integration evidence.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  if (matchedSpecific.has("compose-deploy")) {
    addObligation({
      id: "deploy-compose-validation",
      label: "Compose/deployment validation",
      commandArgv: [
        process.execPath,
        "--test",
        "scripts/verification/deploy-compose-config.test.mjs",
      ],
      command:
        "node --test scripts/verification/deploy-compose-config.test.mjs",
      reason:
        "Compose or deployment assets require validation harness coverage.",
      runInIntegrationProfile: true,
      requiresDocker: false,
    });
  }

  if (matchedSpecific.has("auth-contracts")) {
    addObligation({
      id: "auth-isolation-integration",
      label: "Authentication isolation integration",
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
      reason:
        "Authentication changes require human-session integration evidence.",
      runInIntegrationProfile: true,
      requiresDocker: true,
    });
  }

  const docsLinkCheck = paths.some((file) => {
    const normalized = file.split(path.sep).join("/");
    return (
      normalized.startsWith("docs/") ||
      normalized.endsWith(".md") ||
      normalized.endsWith(".mdx")
    );
  });

  const migrationIntegrity = matchedSpecific.has("db-migrations");

  const runHarnessTests = paths.some((file) =>
    startsWithAny(file, ["scripts/verification/"]),
  );

  const prettierPaths = paths.filter((file) => {
    try {
      return isPrettierPath(file);
    } catch {
      return false;
    }
  });

  const unknown = unknownSourcePaths(paths, packages);

  return {
    changedPaths: paths,
    prettierPaths,
    turboPackageNames: affected.global ? [] : [...turboNames].sort(),
    consumerPackageNames: consumerNames,
    targetedUnitTests: targeted,
    obligations,
    impactSummary: summary,
    unknownSourcePaths: unknown,
    docsLinkCheck,
    migrationIntegrity,
    runHarnessTests,
    globalTurbo: affected.global,
  };
}
