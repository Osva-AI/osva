import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertMobileNavDrawerVisible,
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  setShellThemePreference,
  startConsolePreviewServer,
  waitForMobileNavDrawerSettled,
} from "./m18-1a-browser-helpers.js";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "artifacts",
  "m22-1-office-browser",
);

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function assertNoHorizontalOverflow(
  page: import("playwright").Page,
): Promise<void> {
  const overflow = await readHorizontalOverflow(page);
  if (overflow.docScrollWidth > overflow.docClientWidth + 1) {
    throw new Error(
      `Horizontal overflow: scrollWidth=${overflow.docScrollWidth} clientWidth=${overflow.docClientWidth}`,
    );
  }
}

async function capture(page: import("playwright").Page, fileName: string) {
  ensureEvidenceDir();
  const filePath = path.join(EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

const OFFICE_FIXTURE = {
  workers: [
    {
      id: "ow-accept",
      workspaceId: "ws-admin",
      key: "writer",
      name: "Research Writer With A Very Long Display Name For Layout",
      description: "Organizational identity only.",
      agentId: "agent-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  teams: [
    {
      id: "team-accept",
      workspaceId: "ws-admin",
      key: "core",
      name: "Core Product Team",
      description: "Cross-functional AI workers",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  roles: [
    {
      id: "role-accept",
      key: "lead",
      name: "Lead",
      workspaceId: "ws-admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  assignments: [
    {
      id: "asn-1",
      workspaceId: "ws-admin",
      officeWorkerId: "ow-accept",
      title: "Draft quarterly brief",
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      input: {},
      status: "PENDING",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  memberships: {
    items: [
      {
        teamId: "team-accept",
        officeWorkerId: "ow-accept",
        roleId: "role-accept",
      },
    ],
  },
};

describe("M22.1 Virtual Office browser UI", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  async function installOfficeMocks(page: import("playwright").Page) {
    await installMockConsoleApi(page);
    await page.route("**/api/v1/office/**", async (route) => {
      const url = new URL(route.request().url());
      const { pathname } = url;
      const method = route.request().method();
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });

      if (pathname === "/api/v1/office/workers" && method === "GET") {
        await json({ items: OFFICE_FIXTURE.workers });
        return;
      }
      if (pathname === "/api/v1/office/teams" && method === "GET") {
        await json({ items: OFFICE_FIXTURE.teams });
        return;
      }
      if (pathname === "/api/v1/office/assignments" && method === "GET") {
        await json({ items: OFFICE_FIXTURE.assignments });
        return;
      }
      if (pathname === "/api/v1/office/roles" && method === "GET") {
        await json({ items: OFFICE_FIXTURE.roles });
        return;
      }
      if (
        pathname ===
        `/api/v1/office/teams/${encodeURIComponent("team-accept")}/memberships`
      ) {
        await json(OFFICE_FIXTURE.memberships);
        return;
      }
      if (
        pathname ===
          `/api/v1/office/teams/${encodeURIComponent("team-accept")}` &&
        method === "GET"
      ) {
        await json(OFFICE_FIXTURE.teams[0]);
        return;
      }
      if (
        pathname ===
          `/api/v1/office/workers/${encodeURIComponent("ow-accept")}` &&
        method === "GET"
      ) {
        await json(OFFICE_FIXTURE.workers[0]);
        return;
      }
      if (pathname === "/api/v1/agents" && method === "GET") {
        await json({
          agents: [
            {
              id: "agent-1",
              workspaceId: "ws-admin",
              key: "writer",
              name: "Writer Agent",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
        return;
      }
      await json({ error: "not mocked" }, 404);
    });
  }

  it("renders Mission Control, Teams, and Workers at desktop and mobile with evidence captures", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installOfficeMocks(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/office`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Virtual Office" }).waitFor();
      await page.getByTestId("office-overview-metrics").waitFor();
      await assertNoHorizontalOverflow(page);
      const desktopMission = await capture(
        page,
        "desktop-light-mission-control.png",
      );

      await page.getByRole("link", { name: "Teams" }).first().click();
      await page.getByTestId("office-teams-page").waitFor();
      const desktopTeams = await capture(page, "desktop-light-teams.png");

      await page.getByRole("link", { name: "Workers" }).first().click();
      await page.getByTestId("office-workers-page").waitFor();
      const desktopWorkers = await capture(page, "desktop-light-workers.png");

      await setShellThemePreference(page, "dark");
      await page.goto(`${origin}/office`, { waitUntil: "networkidle" });
      const desktopDark = await capture(
        page,
        "desktop-dark-mission-control.png",
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: true,
      });
      await page.goto(`${origin}/office`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Menu" }).click();
      await waitForMobileNavDrawerSettled(page);
      await assertMobileNavDrawerVisible(page);
      await assertNoHorizontalOverflow(page);
      const mobileMission = await capture(
        page,
        "mobile-light-mission-control.png",
      );

      for (const shot of [
        desktopMission,
        desktopTeams,
        desktopWorkers,
        desktopDark,
        mobileMission,
      ]) {
        if (!shot.includes("m22-1-office-browser")) {
          throw new Error(`Unexpected screenshot path: ${shot}`);
        }
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
