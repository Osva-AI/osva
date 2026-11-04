import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  setShellThemePreference,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "ux-v2-testing-browser",
);

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const MOCK_RUN_ID = "er-mock-1";
const MOCK_SUITE_VERSION_ID = "esv-mock-1";

const MOCK_EVALUATION_CASE = {
  id: "case-1",
  evaluationSuiteVersionId: MOCK_SUITE_VERSION_ID,
  key: "fixture-case",
  name: "Fixture case",
  input: { prompt: "fixture-input" },
  evaluator: {
    type: "JSON_EXACT_MATCH" as const,
    expected: { contains: "fixture-output" },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function seedTestingWorkspace(
  page: import("playwright").Page,
): Promise<void> {
  await page.addInitScript(
    ({ wsId }) => {
      sessionStorage.setItem("osva.console.selectedWorkspaceId", wsId);
    },
    { wsId: "ws-admin" },
  );
}

async function mockTestingApi(page: import("playwright").Page): Promise<void> {
  await page.route("**/api/v1/auth/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userId: "user-browser-1",
          sessionId: "session-browser-1",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    if (pathname === "/api/v1/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userId: "user-browser-1",
          email: "operator@example.com",
          displayName: "Browser Operator",
          status: "ACTIVE",
        }),
      });
      return;
    }
    if (pathname === "/api/v1/auth/workspaces") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspaces: [
            {
              workspaceId: "ws-admin",
              name: "Admin workspace",
              role: "OWNER",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });

  await page.route("**/api/v1/evaluation-suites**", async (route) => {
    const url = route.request().url();
    if (url.match(/\/api\/v1\/evaluation-suites\/[^/]+\/versions/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: MOCK_SUITE_VERSION_ID,
              evaluationSuiteId: "es-mock-1",
              version: 1,
              cases: [MOCK_EVALUATION_CASE],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (url.match(/\/api\/v1\/evaluation-suites\/[^/]+$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "es-mock-1",
          workspaceId: "ws-browser",
          key: "fixture-suite",
          name: "Fixture suite",
          description: "Sanitized browser fixture",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "es-mock-1",
            workspaceId: "ws-browser",
            key: "fixture-suite",
            name: "Fixture suite",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/evaluation-runs**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/case-results")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "cr-1",
              evaluationRunId: MOCK_RUN_ID,
              evaluationCaseId: "case-1",
              runId: "run-child-1",
              outcome: "FAIL",
              evaluatorResults: {},
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (/^\/api\/v1\/evaluation-runs\/[^/]+$/.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: MOCK_RUN_ID,
          workspaceId: "ws-browser",
          evaluationSuiteVersionId: MOCK_SUITE_VERSION_ID,
          targetType: "AGENT_VERSION",
          targetVersionId: "av-mock-1",
          status: "COMPLETED",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:01.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
          summary: {
            totalCases: 1,
            pendingCases: 0,
            runningCases: 0,
            completedCases: 1,
            passedCases: 0,
            failedCases: 1,
            errorCases: 0,
            passRate: 0,
            completionCoverage: 1,
            validScoredCaseCount: 1,
            qualityScore: 0,
            inputTokens: 10,
            outputTokens: 5,
            pricedCostUsdMicros: 0,
            unpricedModelCalls: 0,
            usageMeasured: true,
          },
          qualityGate: {
            policy: {
              schemaVersion: 1,
              rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }],
            },
            assessment: {
              schemaVersion: 1,
              overallVerdict: "FAIL",
              lifecycleVerdict: "PASS",
              ruleResults: [],
              assessedAt: "2026-01-01T00:00:06.000Z",
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: MOCK_RUN_ID,
            workspaceId: "ws-browser",
            evaluationSuiteVersionId: MOCK_SUITE_VERSION_ID,
            targetType: "AGENT_VERSION",
            targetVersionId: "av-mock-1",
            status: "COMPLETED",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/runs/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/runs/run-child-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "run-child-1",
          agentId: "agent-mock-1",
          status: "SUCCEEDED",
          effectiveBindings: {
            agentVersionId: "av-mock-1",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: { prompt: "fixture-input" },
          createdAt: "2026-01-01T00:00:02.000Z",
          updatedAt: "2026-01-01T00:00:04.000Z",
        }),
      });
      return;
    }
    if (pathname === "/api/v1/runs/run-child-1/attempts") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          attempts: [
            {
              id: "ra-mock-1",
              runId: "run-child-1",
              sequence: 1,
              status: "SUCCEEDED",
              createdAt: "2026-01-01T00:00:02.000Z",
              completedAt: "2026-01-01T00:00:04.000Z",
              output: { text: "fixture-output-sanitized" },
            },
          ],
        }),
      });
      return;
    }
    if (pathname === "/api/v1/runs/run-child-1/attempts/ra-mock-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ra-mock-1",
          runId: "run-child-1",
          sequence: 1,
          status: "SUCCEEDED",
          createdAt: "2026-01-01T00:00:02.000Z",
          completedAt: "2026-01-01T00:00:04.000Z",
          output: { text: "fixture-output-sanitized" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.route("**/api/v1/agents**", async (route) => {
    const url = route.request().url();
    if (url.includes("/versions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "av-mock-1",
              agentId: "agent-mock-1",
              version: 1,
              status: "PUBLISHED",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "agent-mock-1",
            workspaceId: "ws-browser",
            key: "fixture-agent",
            name: "Fixture agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/evaluation-suite-versions/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suite: {
          id: "es-mock-1",
          workspaceId: "ws-browser",
          key: "fixture-suite",
          name: "Fixture suite",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        version: {
          id: MOCK_SUITE_VERSION_ID,
          evaluationSuiteId: "es-mock-1",
          version: 1,
          cases: [MOCK_EVALUATION_CASE],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    });
  });
}

describe("UX V2 Testing browser acceptance", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    ensureEvidenceDir();
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures testing studio layouts with gate semantics and themes", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await mockTestingApi(page);
      await seedTestingWorkspace(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/testing`, { waitUntil: "networkidle" });
      await page.getByTestId("testing-v2-page").waitFor({ timeout: 30_000 });
      await page
        .getByRole("link", { name: "Open Agent playground" })
        .waitFor({ state: "visible" });
      const lightPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-testing-hub-light.png",
      );
      await page.screenshot({ path: lightPath, fullPage: true });

      await page.goto(`${origin}/testing/playground`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("testing-playground-page").waitFor();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "desktop-1440-playground-light.png"),
        fullPage: true,
      });

      await page.goto(`${origin}/testing/suites/new`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("evaluation-suite-create-page").waitFor();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "desktop-1440-suite-create-light.png"),
        fullPage: true,
      });

      await page.goto(`${origin}/testing/runs/new`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("evaluation-launch-page").waitFor();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "desktop-1440-launch-light.png"),
        fullPage: true,
      });

      await page.goto(`${origin}/testing/runs/${MOCK_RUN_ID}`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("evaluation-run-detail-page").waitFor();
      await page.getByText("Gate verdict", { exact: true }).waitFor();
      await page.getByText("Fail", { exact: true }).first().waitFor();
      await page.getByText("fixture-output-sanitized").waitFor({
        timeout: 15_000,
      });
      await page.screenshot({
        path: path.join(
          EVIDENCE_DIR,
          "desktop-1440-run-results-gate-light.png",
        ),
        fullPage: true,
      });

      await setShellThemePreference(page, "dark");
      await page.waitForTimeout(400);
      await page.goto(`${origin}/testing`, { waitUntil: "networkidle" });
      await page.getByTestId("testing-v2-page").waitFor();
      const darkPath = path.join(
        EVIDENCE_DIR,
        "desktop-1440-testing-hub-dark.png",
      );
      await page.screenshot({ path: darkPath, fullPage: true });
      expect(fileSha256(darkPath)).not.toBe(fileSha256(lightPath));

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/testing`, { waitUntil: "networkidle" });
        const overflow = await readHorizontalOverflow(page);
        expect(overflow.docScrollWidth).toBeLessThanOrEqual(
          overflow.docClientWidth + 1,
        );
        await page.getByTestId("testing-v2-page").waitFor({ state: "visible" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/testing`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "mobile-390-testing-hub-light.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }, 180_000);
});
