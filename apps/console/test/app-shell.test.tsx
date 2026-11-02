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
    expect(within(nav).getByText("Start")).toBeTruthy();
    expect(within(nav).getByText("Build")).toBeTruthy();
    expect(within(nav).getByText("Resources")).toBeTruthy();
    expect(within(nav).getByText("Operate")).toBeTruthy();

    const agentsLink = within(nav).getByRole("link", { name: "Agents" });
    expect(agentsLink.className).toContain("active");
    expect(within(nav).getByRole("link", { name: "Home" })).toBeTruthy();
  });

  it("shows workspace administration links based on role", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await waitFor(() => {
      expect(
        within(nav).getByRole("link", { name: "Security Activity" }),
      ).toBeTruthy();
    });
    expect(
      within(nav).queryByRole("link", { name: "Workspace Access" }),
    ).toBeNull();
  });

  it("shows member administration for ADMIN", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
          "link",
          { name: "Workspace Access" },
        ),
      ).toBeTruthy();
    });
  });

  it("collapses and expands the desktop sidebar", async () => {
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

  it("persists theme preference and applies it to the document", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1");
    renderShell();

    await waitFor(() => {
      expect(screen.getByLabelText("Theme preference")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Theme preference"), {
      target: { value: "light" },
    });

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

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Workspace switcher") as HTMLSelectElement)
          .value,
      ).toBe("ws-1");
    });

    await userEvent.selectOptions(
      screen.getByLabelText("Workspace switcher"),
      "ws-2",
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Home", level: 1 }),
      ).toBeTruthy();
    });
  });
});
