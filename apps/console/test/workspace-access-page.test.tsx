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
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { WorkspaceAccessPage } from "../src/client/routes/workspace-access-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

const memberships = [
  { id: "m-owner", userId: "user-owner", role: "OWNER" },
  { id: "m-dev", userId: "user-dev", role: "DEVELOPER" },
  { id: "m-admin-target", userId: "user-target", role: "VIEWER" },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <WorkspaceAccessPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: undefined },
  );
}

function stubMemberships(
  role: string,
  extra?: (url: string, init?: RequestInit) => Response | undefined,
) {
  return stubHumanSessionFetch(role, "ws-1", (url, init) => {
    const method = init?.method ?? "GET";
    const extraResponse = extra?.(url, init);
    if (extraResponse !== undefined) {
      return extraResponse;
    }
    if (
      url.includes("/api/v1/auth/workspaces/ws-1/memberships") &&
      method === "GET" &&
      !url.includes("/grant-owner")
    ) {
      return json({ memberships });
    }
    return undefined;
  });
}

describe("Workspace access page", () => {
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy as typeof window.confirm;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("shows setup token only until dismissed", async () => {
    stubMemberships("OWNER", (url, init) => {
      if (url.includes("/members/users") && init?.method === "POST") {
        return json(
          { setupToken: "setup-once-token", user: { userId: "u-new" } },
          201,
        );
      }
      return undefined;
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Provision user" }),
      ).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "New User" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Provision" }));
    await waitFor(() => {
      expect(screen.getByText("setup-once-token")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("setup-once-token")).toBeNull();
  });

  it("lets OWNER promote another member after confirmation", async () => {
    const fetchMock = stubMemberships("OWNER", (url, init) => {
      if (
        url.endsWith("/memberships/m-dev/grant-owner") &&
        init?.method === "POST"
      ) {
        return json({ ok: true });
      }
      return undefined;
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Promote to owner" }).length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Promote to owner" })[0]!,
    );
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([calledUrl, init]) =>
            String(calledUrl).includes("/grant-owner") &&
            init?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("does not offer remove controls on OWNER membership rows", async () => {
    stubMemberships("OWNER");
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("user-owner")).toBeTruthy();
    });
    const ownerRow = screen.getByText("user-owner").closest("tr");
    expect(ownerRow?.textContent).not.toContain("Remove");
  });

  it("blocks ADMIN from managing OWNER rows in the UI", async () => {
    stubMemberships("ADMIN");
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("user-owner")).toBeTruthy();
    });
    expect(
      screen.getByText("Only an owner can change or remove owners."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Promote to owner" }),
    ).toBeNull();
  });

  it("lets ADMIN change a non-owner membership role", async () => {
    const user = userEvent.setup();
    const fetchMock = stubMemberships("ADMIN", (url, init) => {
      if (
        url.endsWith("/memberships/m-admin-target") &&
        init?.method === "PATCH"
      ) {
        return json({ id: "m-admin-target", role: "OPERATOR" });
      }
      return undefined;
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Role for user-target")).toBeTruthy();
    });
    await user.selectOptions(
      screen.getByLabelText("Role for user-target"),
      "OPERATOR",
    );
    const targetRow = screen.getByText("user-target").closest("tr")!;
    await user.click(
      within(targetRow).getByRole("button", { name: "Save role" }),
    );
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([calledUrl, init]) =>
            String(calledUrl).includes("/memberships/m-admin-target") &&
            init?.method === "PATCH",
        ),
      ).toBe(true);
    });
  });

  it("requires confirmation before removal", async () => {
    confirmSpy.mockImplementationOnce(() => false);
    const fetchMock = stubMemberships("OWNER");
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Remove" }).length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });
});
