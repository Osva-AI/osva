import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openOnboarding,
  routeOnboardingConfiguredWorkspace,
  routeOnboardingEmptyWorkspace,
  seedShellStorage,
  startConsolePreviewServer,
  waitForOnboarding,
} from "./m18-4-browser-helpers.js";
import { captureOnboardingEvidence } from "./ux-v2-onboarding-browser-helpers.js";

describe("UX V2.3 browser acceptance (guided onboarding evidence)", () => {
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

  it("captures distinct onboarding states with viewport and state assertions", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      async function freshPage(): Promise<import("playwright").Page> {
        const context = await browser.newContext();
        return context.newPage();
      }

      // Stage 1 ready (desktop)
      {
        const page = await freshPage();
        await routeOnboardingEmptyWorkspace(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=get-ready",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage1-ready-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByTestId("onboarding-primary-step").waitFor();
              await page
                .getByRole("heading", {
                  name: /Let's make sure OSVA is ready/i,
                })
                .waitFor();
              await page.getByText(/What we can verify/i).waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 1 blocked / service unavailable
      {
        const page = await freshPage();
        await routeOnboardingEmptyWorkspace(page);
        await page.route("**/api/v1/agents", async (route) => {
          await route.fulfill({ status: 503, body: "Unavailable" });
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=get-ready",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-service-unavailable-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByText(/Could not load onboarding progress/i)
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 2 configured
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeRuns: false,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=choose-model",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage2-configured-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByText(/Configured in workspace/i).waitFor();
              await page
                .locator(".onboarding-v2-pill-good")
                .getByText("Configured", { exact: true })
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 2 unconfigured
      {
        const page = await freshPage();
        await routeOnboardingEmptyWorkspace(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=choose-model",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage2-unconfigured-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByText(/No model configured yet/i)
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 3 agent creation (no agent yet)
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeAgents: false,
          includePublishedVersion: false,
          includeRuns: false,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=create-agent",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage3-create-agent-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByRole("heading", { name: /Tell your agent what to do/i })
                .waitFor();
              await page.getByRole("link", { name: "Create Agent" }).waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 4 unpublished
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includePublishedVersion: false,
          includeRuns: false,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=review-test",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage4-unpublished-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByText(/Not published yet/i).waitFor();
              await page
                .getByTestId("onboarding-run-status")
                .getByText(/Not started yet/i)
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Stage 4 published, not yet tested
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeRuns: false,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query:
            "?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-stage4-ready-to-test-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByText(/Ready to test/i).waitFor();
              await page
                .getByRole("link", { name: "Start test run" })
                .waitFor();
              await page
                .getByTestId("onboarding-run-status")
                .getAttribute("data-run-phase")
                .then((value) => {
                  if (value !== "NONE") {
                    throw new Error(
                      `Expected NONE run phase, got ${value ?? ""}`,
                    );
                  }
                });
            },
          },
        );
        await page.close();
      }

      // Run queued
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          runStatus: "QUEUED",
          includeRuns: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
        await page.goto(
          `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test`,
          { waitUntil: "networkidle" },
        );
        await waitForOnboarding(page);
        await captureOnboardingEvidence(
          page,
          "desktop-1440-run-queued-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByTestId("onboarding-run-progress-message")
                .getByText(/Your test is waiting to start/i)
                .waitFor();
              await page
                .getByTestId("onboarding-run-status")
                .getAttribute("data-run-phase")
                .then((value) => {
                  if (value !== "QUEUED") {
                    throw new Error(`Expected QUEUED, got ${value ?? ""}`);
                  }
                });
              await page
                .getByRole("link", { name: "Start test run" })
                .count()
                .then((count) => {
                  if (count !== 0) {
                    throw new Error(
                      "Start test run should be hidden while queued",
                    );
                  }
                });
            },
          },
        );
        await page.close();
      }

      // Run running
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          runStatus: "RUNNING",
          includeRuns: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
        await page.goto(
          `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test`,
          { waitUntil: "networkidle" },
        );
        await waitForOnboarding(page);
        await captureOnboardingEvidence(
          page,
          "desktop-1440-run-running-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByTestId("onboarding-run-progress-message")
                .getByText(/Your agent is working on the test/i)
                .waitFor();
              await page
                .getByTestId("onboarding-run-status")
                .getAttribute("data-run-phase")
                .then((value) => {
                  if (value !== "RUNNING") {
                    throw new Error(`Expected RUNNING, got ${value ?? ""}`);
                  }
                });
            },
          },
        );
        await page.close();
      }

      // Run failed
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          runStatus: "FAILED",
          includeRuns: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
        await page.goto(
          `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test`,
          { waitUntil: "networkidle" },
        );
        await waitForOnboarding(page);
        await captureOnboardingEvidence(
          page,
          "desktop-1440-run-failed-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByText(/Test did not succeed/i).waitFor();
              await page
                .getByTestId("onboarding-run-status")
                .getAttribute("data-run-phase")
                .then((value) => {
                  if (value !== "FAILED") {
                    throw new Error(`Expected FAILED, got ${value ?? ""}`);
                  }
                });
            },
          },
        );
        await page.close();
      }

      // Run succeeded
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          runStatus: "SUCCEEDED",
          includeRuns: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
        await page.goto(
          `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test`,
          { waitUntil: "networkidle" },
        );
        await waitForOnboarding(page);
        await captureOnboardingEvidence(
          page,
          "desktop-1440-run-succeeded-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page.getByTestId("onboarding-completion").waitFor();
              await page
                .getByRole("heading", {
                  name: /Your first agent test succeeded/i,
                })
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Read-only viewer
      {
        const page = await freshPage();
        await routeOnboardingEmptyWorkspace(page);
        await page.route("**/api/v1/auth/workspaces", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              workspaces: [
                {
                  workspaceId: "ws-admin",
                  name: "Acme Admin",
                  role: "VIEWER",
                },
              ],
            }),
          });
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=choose-model",
        });
        await captureOnboardingEvidence(
          page,
          "desktop-1440-read-only-viewer-light.png",
          {
            expectedViewportWidth: 1440,
            assertState: async () => {
              await page
                .getByTestId("onboarding-primary-step")
                .getByText(/requires DEVELOPER, ADMIN, or OWNER/i)
                .waitFor();
            },
          },
        );
        await page.close();
      }

      // Dark + tablet
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeRuns: false,
        });
        await openOnboarding(page, origin, {
          theme: "dark",
          query: "?stage=choose-model",
        });
        await page.getByLabel("Theme").click();
        await page.getByRole("radio", { name: "Dark" }).click();
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "dark",
        );
        await page.setViewportSize({ width: 768, height: 900 });
        await captureOnboardingEvidence(page, "tablet-768-stage2-dark.png", {
          expectedViewportWidth: 768,
          assertState: async () => {
            await page.getByText(/Configured in workspace/i).waitFor();
          },
        });
        await page.close();
      }

      // Mobile 390 — initial viewport and expanded navigation
      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, { includeRuns: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=choose-model",
        });
        await captureOnboardingEvidence(
          page,
          "mobile-390-stage2-initial-viewport-light.png",
          {
            expectedViewportWidth: 390,
            assertState: async () => {
              await page.getByTestId("onboarding-mobile-progress").waitFor();
              const stageTitle = page
                .getByTestId("onboarding-primary-step")
                .getByRole("heading", { name: "Set up your AI model" });
              await stageTitle.waitFor();
              const desktopHidden = await page
                .locator(".onboarding-v2-progress-desktop")
                .isHidden();
              if (!desktopHidden) {
                throw new Error("Desktop stepper should be hidden on mobile");
              }
              const titleBox = await stageTitle.boundingBox();
              if (titleBox === null || titleBox.y > 420) {
                throw new Error(
                  "Stage heading should appear in the initial mobile viewport",
                );
              }
            },
          },
        );
        await page.getByText("View all steps").click();
        await page.locator(".onboarding-v2-progress-mobile-list").waitFor();
        await captureOnboardingEvidence(
          page,
          "mobile-390-stage2-steps-expanded-light.png",
          {
            expectedViewportWidth: 390,
            assertState: async () => {
              await page
                .locator(".onboarding-v2-progress-mobile-list")
                .getByText(/Set up your AI model/i)
                .waitFor();
              await page
                .locator(".onboarding-v2-progress-mobile-list")
                .getByText(/Create your agent/i)
                .waitFor();
            },
          },
        );
        await page.close();
      }

      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeAgents: false,
          includePublishedVersion: false,
          includeRuns: false,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await openOnboarding(page, origin, {
          theme: "light",
          query: "?stage=create-agent",
        });
        await captureOnboardingEvidence(
          page,
          "mobile-390-stage3-initial-viewport-light.png",
          {
            expectedViewportWidth: 390,
            assertState: async () => {
              await page
                .getByRole("heading", { name: /Tell your agent what to do/i })
                .waitFor();
              const titleBox = await page
                .getByRole("heading", { name: /Tell your agent what to do/i })
                .boundingBox();
              if (titleBox === null || titleBox.y > 420) {
                throw new Error(
                  "Stage 3 heading should appear in the initial mobile viewport",
                );
              }
            },
          },
        );
        await page.close();
      }

      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          includeRuns: false,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await openOnboarding(page, origin, {
          theme: "light",
          query:
            "?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test",
        });
        await captureOnboardingEvidence(
          page,
          "mobile-390-stage4-initial-viewport-light.png",
          {
            expectedViewportWidth: 390,
            assertState: async () => {
              await page
                .getByRole("heading", { name: /Review, publish, and test/i })
                .waitFor();
            },
          },
        );
        await page.close();
      }

      {
        const page = await freshPage();
        await routeOnboardingConfiguredWorkspace(page, {
          runStatus: "FAILED",
          includeRuns: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await seedShellStorage(page, { workspaceId: "ws-admin", theme: "light" });
        await page.goto(
          `${origin}/onboarding?agentId=agent-onb-1&agentVersionId=av-onb-1&stage=review-test`,
          { waitUntil: "networkidle" },
        );
        await waitForOnboarding(page);
        await captureOnboardingEvidence(
          page,
          "mobile-390-stage4-failure-recovery-scrolled-light.png",
          {
            expectedViewportWidth: 390,
            beforeCapture: async () => {
              await page
                .getByTestId("onboarding-run-failure-recovery")
                .scrollIntoViewIfNeeded();
            },
            assertState: async () => {
              await page.getByTestId("onboarding-run-failure-recovery").waitFor();
              await page.getByText(/Test did not succeed/i).waitFor();
            },
          },
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 420_000);
});
