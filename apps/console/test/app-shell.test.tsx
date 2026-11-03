import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { THEME_PREFERENCE_STORAGE_KEY } from "../src/client/lib/theme-preference";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function mockViewport(options: { mobile?: boolean; prefersLight?: boolean }) {
  const mobile = options.mobile ?? false;
  const prefersLight = options.prefersLight ?? false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches:
        query === "(max-width: 900px)"
          ? mobile
          : query === "(prefers-color-scheme: light)"
            ? prefersLight
            : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderShell(initialPath = "/overview") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/overview" element={<h1>Home</h1>} />
              <Route path="/agents" element={<h1>Agents</h1>} />
              <Route path="/activity" element={<h1>Activity</h1>} />
              <Route path="/runs" element={<h1>Runs</h1>} />
              <Route
                path="/workspace/access"
                element={<h1>Workspace Access</h1>}
              />
              <Route
                path="/workspace/security"
                element={<h1>Security Activity</h1>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AppShell navigation", () => {
  beforeEach(() => {
    mockViewport({ mobile: false });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it("groups primary navigation and marks the active route", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell("/agents");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Agents", level: 1 }),
      ).toBeTruthy();
    });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByText("Build")).toBeTruthy();
    expect(within(nav).getByText("Manage")).toBeTruthy();

    const agentsLink = within(nav).getByRole("link", { name: "Agents" });
    expect(agentsLink.className).toContain("active");
    expect(within(nav).getByRole("link", { name: "Home" })).toBeTruthy();
    expect(
      within(nav).queryByRole("link", { name: "Getting started" }),
    ).toBeNull();
  });

  it("expands resources and links integrations honestly", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await userEvent.click(screen.getByRole("button", { name: "Resources" }));
    const integrations = within(nav).getByRole("link", {
      name: "Integrations",
    });
    expect(integrations.getAttribute("href")).toContain("/tools");
  });

  it("marks Activity active on runs routes", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell("/runs");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Runs", level: 1 }),
      ).toBeTruthy();
    });

    const activityLink = within(
      screen.getByRole("navigation", { name: "Primary" }),
    ).getByRole("link", { name: "Activity" });
    expect(activityLink.className).toContain("active");
  });

  it("opens workspace administration from the account menu for ADMIN", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByLabelText("Account and workspace")).toBeTruthy();
    });

    await userEvent.click(screen.getByLabelText("Account and workspace"));
    expect(
      screen.getByRole("dialog", { name: "Account and workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Workspace Access" }),
    ).toBeTruthy();
  });

  it("collapses and expands the desktop sidebar from the header", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Collapse navigation" }),
      ).toBeTruthy();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Collapse navigation" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand navigation" }),
    ).toBeTruthy();
    expect(localStorage.getItem("osva.console.sidebarCollapsed")).toBe("1");
  });

  it("opens mobile navigation and closes on Escape", async () => {
    mockViewport({ mobile: true });
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(
      screen
        .getByRole("button", { name: "Menu" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Menu" })
          .getAttribute("aria-expanded"),
      ).toBe("false");
    });
  });

  it("opens create menu routes for agent and workflow creation", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const menu = screen.getByRole("menu", { name: "Create" });
    expect(
      within(menu).getByRole("menuitem", { name: /Create an agent/i }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: /Build a workflow/i }),
    ).toBeTruthy();
  });

  it("routes guided setup from the header help menu", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByLabelText("Help")).toBeTruthy();
    });

    await userEvent.click(screen.getByLabelText("Help"));
    expect(
      screen.getByRole("dialog", { name: "Help and guidance" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Guided setup/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Help$/i })).toBeNull();
  });

  it("persists theme preference from the header theme menu", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByLabelText("Theme")).toBeTruthy();
    });

    await userEvent.click(screen.getByLabelText("Theme"));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("redirects away from workspace admin when switching to a viewer workspace", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/auth/workspaces")) {
        return json({
          workspaces: [
            { workspaceId: "ws-1", name: "Admin ws", role: "ADMIN" },
            { workspaceId: "ws-2", name: "Viewer ws", role: "VIEWER" },
          ],
        });
      }
      return undefined;
    });

    renderShell("/workspace/access");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Workspace Access", level: 1 }),
      ).toBeTruthy();
    });

    await userEvent.click(screen.getByLabelText("Account and workspace"));
    await userEvent.click(
      screen.getByRole("button", { name: /Admin ws.*Switch/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Viewer ws/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Home", level: 1 }),
      ).toBeTruthy();
    });
  });
});
