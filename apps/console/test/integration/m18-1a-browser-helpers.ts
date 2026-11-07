import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page, Route } from "playwright";

import { ensureConsoleClientDistForBrowserTests } from "./ensure-console-client-dist.js";
import {
  allocateLoopbackPort,
  loopbackOrigin,
} from "./allocate-loopback-port.js";

const consoleRoot = path.resolve(process.cwd());

export const M18_1A_EVIDENCE_DIR = path.join(
  consoleRoot,
  "artifacts",
  "m18-1a-browser",
);

export interface MockWorkspace {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: string;
}

const DEFAULT_WORKSPACES: readonly MockWorkspace[] = [
  { workspaceId: "ws-admin", name: "Acme Admin", role: "ADMIN" },
  { workspaceId: "ws-dev", name: "Acme Build", role: "DEVELOPER" },
];

export function ensureEvidenceDir(): void {
  mkdirSync(M18_1A_EVIDENCE_DIR, { recursive: true });
}

export async function startConsolePreviewServer(): Promise<{
  readonly origin: string;
  readonly stop: () => Promise<void>;
}> {
  ensureConsoleClientDistForBrowserTests();
  const port = await allocateLoopbackPort();
  const origin = loopbackOrigin(port);

  const previewProcess: ChildProcess = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: consoleRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: process.env,
    },
  );

  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (previewProcess.exitCode !== null) {
      throw new Error(
        `vite preview exited early with code ${String(previewProcess.exitCode)}`,
      );
    }
    try {
      const response = await fetch(origin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // preview still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!ready) {
    previewProcess.kill("SIGTERM");
    throw new Error("Timed out waiting for vite preview.");
  }

  return {
    origin,
    stop: async () => {
      if (previewProcess === undefined) {
        return;
      }
      previewProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        previewProcess?.once("exit", () => resolve());
        setTimeout(resolve, 3_000);
      });
    },
  };
}

function apiJson(
  body: unknown,
  status = 200,
): { status: number; body: string } {
  return {
    status,
    body: JSON.stringify(body),
  };
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export interface MockRunDetailResponses {
  readonly runId: string;
  readonly run: Readonly<Record<string, unknown>>;
  readonly attempts: Readonly<Record<string, unknown>>;
  readonly recovery: Readonly<Record<string, unknown>>;
  readonly resumeResponse?: Readonly<Record<string, unknown>>;
  readonly resumeStatus?: number;
}

export interface MockNlBuilderCaptures {
  readonly generateRequests: { readonly url: string; readonly body: unknown }[];
  readonly validateRequests: { readonly url: string; readonly body: unknown }[];
  readonly prepareRequests?: {
    readonly url: string;
    readonly body: unknown;
  }[];
  readonly publishRequests?: {
    readonly url: string;
    readonly body: unknown;
  }[];
}

export interface MockNlBuilderOptions {
  readonly modelProfileId: string;
  readonly modelProfileVersionId: string;
  readonly generateProposal: unknown;
  readonly validateResponse?: unknown;
  /**
   * When set, POSTs to agent/workflow publish or run endpoints abort so tests can assert they never fire.
   */
  readonly recordForbiddenPosts?: boolean;
  readonly forbiddenHits?: { method: string; url: string }[];
  readonly captures?: MockNlBuilderCaptures;
  readonly publication?: {
    readonly planDigest: string;
    readonly workflowId: string;
    readonly workflowVersionId: string;
    readonly publicationId: string;
    /** When true, the first publish POST aborts (simulates lost response). */
    readonly abortFirstPublish?: boolean;
  };
}

function isNlBuilderForbiddenPost(pathname: string): boolean {
  if (pathname === "/api/v1/agents") {
    return true;
  }
  if (/^\/api\/v1\/agents\/[^/]+\/versions$/.test(pathname)) {
    return true;
  }
  if (pathname === "/api/v1/workflows") {
    return true;
  }
  if (/^\/api\/v1\/workflows\/[^/]+\/versions$/.test(pathname)) {
    return true;
  }
  if (pathname === "/api/v1/runs" || pathname.startsWith("/api/v1/runs/")) {
    return true;
  }
  if (
    pathname === "/api/v1/workflow-runs" ||
    pathname.startsWith("/api/v1/workflow-runs/")
  ) {
    return true;
  }
  return false;
}

export async function installMockConsoleApi(
  page: Page,
  options: {
    readonly workspaces?: readonly MockWorkspace[];
    readonly runDetail?: MockRunDetailResponses;
    readonly nlBuilder?: MockNlBuilderOptions;
  } = {},
): Promise<void> {
  const workspaces = options.workspaces ?? DEFAULT_WORKSPACES;
  const runDetail = options.runDetail;
  const nlBuilder = options.nlBuilder;
  let publicationPublishAttempts = 0;

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (
      nlBuilder !== undefined &&
      nlBuilder.recordForbiddenPosts === true &&
      nlBuilder.forbiddenHits !== undefined &&
      method === "POST" &&
      isNlBuilderForbiddenPost(pathname)
    ) {
      nlBuilder.forbiddenHits.push({ method, url: route.request().url() });
      await route.abort("failed");
      return;
    }

    if (nlBuilder !== undefined) {
      if (pathname === "/api/v1/model-profiles" && method === "GET") {
        await fulfillJson(route, {
          modelProfiles: [
            {
              id: nlBuilder.modelProfileId,
              key: "mp-browser",
              name: "Browser OpenAI",
            },
          ],
        });
        return;
      }
      if (
        pathname ===
          `/api/v1/model-profiles/${encodeURIComponent(nlBuilder.modelProfileId)}/versions` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          versions: [
            {
              id: nlBuilder.modelProfileVersionId,
              modelProfileId: nlBuilder.modelProfileId,
              version: 1,
              provider: "OPENAI",
              model: "gpt-test",
            },
          ],
        });
        return;
      }
      if (
        pathname === "/api/v1/builder/proposals/generate" &&
        method === "POST"
      ) {
        const raw = route.request().postData() ?? "{}";
        let body: unknown;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          body = { _parseError: raw };
        }
        nlBuilder.captures?.generateRequests.push({
          url: route.request().url(),
          body,
        });
        await fulfillJson(route, {
          ok: true,
          proposal: nlBuilder.generateProposal,
          compileIssues: [],
        });
        return;
      }
      if (
        pathname === "/api/v1/builder/publications/prepare" &&
        method === "POST"
      ) {
        const raw = route.request().postData() ?? "{}";
        let body: unknown = {};
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          body = { _parseError: raw };
        }
        nlBuilder.captures?.prepareRequests?.push({
          url: route.request().url(),
          body,
        });
        const pub = nlBuilder.publication;
        await fulfillJson(
          route,
          pub
            ? {
                publishable: true,
                planDigest: pub.planDigest,
                workflowRegistry:
                  (body as { proposal?: { workflowRegistry?: unknown } })
                    .proposal?.workflowRegistry ?? {},
                newAgents: [],
                reusedAgents: [],
                blockingIssues: [],
                warnings: [],
                assumptions: [],
                unresolvedRequirements: [],
                requiresUnresolvedAcknowledgement: false,
              }
            : { publishable: false, blockingIssues: [{ code: "x" }] },
        );
        return;
      }
      if (pathname === "/api/v1/builder/publications" && method === "POST") {
        const raw = route.request().postData() ?? "{}";
        let body: unknown = {};
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          body = { _parseError: raw };
        }
        nlBuilder.captures?.publishRequests?.push({
          url: route.request().url(),
          body,
        });
        const pub = nlBuilder.publication;
        if (pub === undefined) {
          await fulfillJson(route, { ok: false }, 422);
          return;
        }
        publicationPublishAttempts += 1;
        if (
          pub.abortFirstPublish === true &&
          publicationPublishAttempts === 1
        ) {
          await route.abort("failed");
          return;
        }
        const replay = publicationPublishAttempts > 1;
        await fulfillJson(
          route,
          {
            ok: true,
            replay,
            receipt: {
              id: pub.publicationId,
              state: "SUCCEEDED",
              workspaceId: "ws-admin",
              planDigest: pub.planDigest,
              workflowId: pub.workflowId,
              workflowVersionId: pub.workflowVersionId,
              newAgents: [
                {
                  agentId: "ag-browser-1",
                  agentVersionId: "av-browser-1",
                  ref: "bpr_a",
                  agentKey: "browser_agent",
                },
              ],
              reusedAgentVersionIds: [],
              refResolution: [{ ref: "bpr_a", agentVersionId: "av-browser-1" }],
              publishedAt: "2099-01-01T00:00:00.000Z",
            },
          },
          replay ? 200 : 201,
        );
        return;
      }
      if (
        /^\/api\/v1\/builder\/publications\/[^/]+$/.test(pathname) &&
        method === "GET"
      ) {
        const pub = nlBuilder.publication;
        await fulfillJson(
          route,
          pub
            ? {
                ok: true,
                receipt: {
                  id: pub.publicationId,
                  state: "SUCCEEDED",
                  workflowId: pub.workflowId,
                  workflowVersionId: pub.workflowVersionId,
                },
              }
            : { ok: false },
        );
        return;
      }
      if (
        pathname === "/api/v1/builder/proposals/validate" &&
        method === "POST"
      ) {
        const raw = route.request().postData() ?? "{}";
        let body: unknown;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          body = { _parseError: raw };
        }
        nlBuilder.captures?.validateRequests.push({
          url: route.request().url(),
          body,
        });
        await fulfillJson(
          route,
          nlBuilder.validateResponse ?? {
            ok: true,
            issues: [],
            previewLogicalWorkflowDigest: "digest-browser-m20-3",
          },
        );
        return;
      }
    }

    if (runDetail !== undefined) {
      const { runId } = runDetail;
      if (pathname === `/api/v1/runs/${runId}` && method === "GET") {
        await fulfillJson(route, runDetail.run);
        return;
      }
      if (pathname === `/api/v1/runs/${runId}/attempts` && method === "GET") {
        await fulfillJson(route, runDetail.attempts);
        return;
      }
      if (pathname === `/api/v1/runs/${runId}/recovery` && method === "GET") {
        await fulfillJson(route, runDetail.recovery);
        return;
      }
      if (pathname === `/api/v1/runs/${runId}/resume` && method === "POST") {
        await fulfillJson(
          route,
          runDetail.resumeResponse ?? {
            runId,
            runAttemptId: "ra-successor-1",
            outcome: "scheduled",
          },
          runDetail.resumeStatus ?? 202,
        );
        return;
      }
    }

    if (pathname === "/api/v1/auth/session") {
      await fulfillJson(route, {
        userId: "user-browser-1",
        sessionId: "session-browser-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      return;
    }
    if (pathname === "/api/v1/auth/me") {
      await fulfillJson(route, {
        userId: "user-browser-1",
        email: "operator@example.com",
        displayName: "Browser Operator",
        status: "ACTIVE",
      });
      return;
    }
    if (pathname === "/api/v1/auth/workspaces") {
      await fulfillJson(route, { workspaces });
      return;
    }
    if (pathname === "/api/v1/agents") {
      await fulfillJson(route, { agents: [] });
      return;
    }
    if (pathname === "/api/v1/workflows") {
      await fulfillJson(route, { workflows: [] });
      return;
    }
    if (pathname === "/api/v1/runs") {
      await fulfillJson(route, { runs: [] });
      return;
    }
    if (pathname === "/api/v1/workflow-runs") {
      await fulfillJson(route, { workflowRuns: [] });
      return;
    }
    if (pathname === "/api/v1/model-profiles") {
      await fulfillJson(route, { modelProfiles: [] });
      return;
    }
    if (pathname === "/api/v1/model-provider-connections") {
      await fulfillJson(route, { connections: [] });
      return;
    }
    if (
      pathname.startsWith("/api/v1/model-profiles/") &&
      pathname.endsWith("/versions")
    ) {
      await fulfillJson(route, { versions: [] });
      return;
    }
    if (pathname === "/api/v1/tools") {
      await fulfillJson(route, { tools: [] });
      return;
    }
    if (pathname === "/api/v1/connectors") {
      await fulfillJson(route, { connectors: [] });
      return;
    }
    if (pathname === "/api/v1/knowledge/sources") {
      await fulfillJson(route, { sources: [] });
      return;
    }
    if (pathname === "/api/v1/memory/namespaces") {
      await fulfillJson(route, { namespaces: [] });
      return;
    }
    if (pathname === "/api/v1/evaluation-suites") {
      await fulfillJson(route, { items: [] });
      return;
    }
    if (pathname === "/api/v1/evaluation-runs") {
      await fulfillJson(route, { items: [], nextCursor: undefined });
      return;
    }
    if (
      pathname.includes("/api/v1/auth/workspaces/") &&
      pathname.endsWith("/memberships") &&
      route.request().method() === "GET"
    ) {
      await fulfillJson(route, {
        memberships: [
          { id: "m-admin", userId: "user-owner", role: "OWNER" },
          { id: "m-dev", userId: "user-dev", role: "DEVELOPER" },
        ],
      });
      return;
    }

    const fallback = apiJson({ error: "not mocked", path: pathname }, 404);
    await route.fulfill({
      status: fallback.status,
      contentType: "application/json",
      body: fallback.body,
    });
  });
}

export async function seedShellStorage(
  page: Page,
  options: {
    readonly workspaceId?: string;
    /** When false, do not set `selectedWorkspaceId` on each navigation (for tests that switch workspace in-session). */
    readonly seedWorkspaceId?: boolean;
    readonly theme?: "light" | "dark" | "system";
    readonly sidebarCollapsed?: boolean;
  } = {},
): Promise<void> {
  const workspaceId = options.workspaceId ?? "ws-admin";
  const seedWorkspaceId = options.seedWorkspaceId ?? true;
  const theme = options.theme ?? "light";
  const sidebarCollapsed = options.sidebarCollapsed ?? false;

  await page.addInitScript(
    ({ wsId, themePref, collapsed, seedWs }) => {
      if (seedWs) {
        sessionStorage.setItem("osva.console.selectedWorkspaceId", wsId);
      } else if (
        sessionStorage.getItem("osva.console.selectedWorkspaceId") === null
      ) {
        sessionStorage.setItem("osva.console.selectedWorkspaceId", wsId);
      }
      localStorage.setItem("osva.console.themePreference", themePref);
      if (collapsed) {
        localStorage.setItem("osva.console.sidebarCollapsed", "1");
      } else {
        localStorage.removeItem("osva.console.sidebarCollapsed");
      }
    },
    {
      wsId: workspaceId,
      themePref: theme,
      collapsed: sidebarCollapsed,
      seedWs: seedWorkspaceId,
    },
  );
}

export async function readHorizontalOverflow(page: Page): Promise<{
  readonly docScrollWidth: number;
  readonly docClientWidth: number;
  readonly bodyScrollWidth: number;
}> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      docScrollWidth: root.scrollWidth,
      docClientWidth: root.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

export async function screenshotShell(
  page: Page,
  fileName: string,
): Promise<string> {
  ensureEvidenceDir();
  const filePath = path.join(M18_1A_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

export async function waitForOverview(page: Page): Promise<void> {
  await page.locator(".home-v2, .home-v2-loading").first().waitFor({
    timeout: 30_000,
  });
}

export function expectViewportSize(
  page: Page,
  width: number,
  height: number,
): void {
  const size = page.viewportSize();
  if (size === null) {
    throw new Error("Expected viewport size but viewportSize() returned null");
  }
  if (size.width !== width || size.height !== height) {
    throw new Error(
      `Expected viewport ${width}x${height}, got ${size.width}x${size.height}`,
    );
  }
}

export async function waitForMobileNavDrawerSettled(page: Page): Promise<void> {
  await page.waitForSelector(".app-shell.mobile-nav-open");
  await page.waitForSelector('.shell-sidebar-drawer[data-open="true"]');
  await page.waitForFunction(() => {
    const drawer = document.querySelector(
      '.shell-sidebar-drawer[data-open="true"]',
    );
    if (!(drawer instanceof HTMLElement)) {
      return false;
    }
    const rect = drawer.getBoundingClientRect();
    if (rect.left < -1 || rect.width < 200) {
      return false;
    }
    const matrix = new DOMMatrix(getComputedStyle(drawer).transform);
    return Math.abs(matrix.m41) < 2;
  });
}

export async function clickResourcesNavLink(
  page: Page,
  label: "Models" | "Integrations" | "Knowledge" | "Memory",
): Promise<void> {
  const resourcesButton = page.getByRole("button", { name: "Resources" });
  if ((await resourcesButton.getAttribute("aria-expanded")) !== "true") {
    await resourcesButton.click();
  }
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: label, exact: true })
    .click();
}

export async function assertMobileNavDrawerVisible(page: Page): Promise<void> {
  const drawer = page.locator('.shell-sidebar-drawer[data-open="true"]');
  await drawer.waitFor({ state: "visible" });

  const box = await drawer.boundingBox();
  if (box === null || box.x > 1 || box.width < 200) {
    throw new Error(
      `Mobile drawer not fully on-screen: ${JSON.stringify(box)}`,
    );
  }

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  for (const label of [
    "Home",
    "Agents",
    "Workflows",
    "Activity",
    "Testing",
    "Settings",
  ]) {
    await primaryNav.getByRole("link", { name: label, exact: true }).waitFor({
      state: "visible",
    });
  }
}

export async function setShellThemePreference(
  page: Page,
  theme: "light" | "dark" | "system",
): Promise<void> {
  await page.getByLabel("Theme").click();
  const label = theme.charAt(0).toUpperCase() + theme.slice(1);
  await page.getByRole("radio", { name: label }).click();
  if (theme !== "system") {
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      theme,
    );
  }
}

export async function switchShellWorkspace(
  page: Page,
  workspaceName: string | RegExp,
): Promise<void> {
  await page.getByRole("button", { name: "Account and workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Account and workspace" });
  const workspaceTrigger = dialog.getByRole("button", { name: /Switch/i });
  if ((await workspaceTrigger.count()) > 0) {
    await workspaceTrigger.first().click();
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: workspaceName })
    .click();
}
