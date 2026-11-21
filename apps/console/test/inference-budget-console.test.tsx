import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";

import { AuthProvider } from "../src/client/context/auth-context";
import { InferenceBudgetPage } from "../src/client/routes/inference-budget-page";
import { InferenceBudgetPolicyDetailPage } from "../src/client/routes/inference-budget-policy-detail-page";
import type { WorkspaceInferenceBudgetConfigurationResource } from "../src/client/hooks/use-inference-budget";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderBudget(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/settings/inference-budget"
              element={<InferenceBudgetPage />}
            />
            <Route
              path="/settings/inference-budget/:policyId"
              element={<InferenceBudgetPolicyDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const defaultConfig: WorkspaceInferenceBudgetConfigurationResource = {
  activation: { enabled: false, updatedAt: "2026-03-01T00:00:00.000Z" },
  runtimePolicy: { enabled: false },
  activationMutationsPermitted: false,
};

const periodUsageWithLedger = {
  period: {
    periodKind: "CALENDAR_MONTH_UTC",
    periodKey: "2026-03",
    periodStartUtc: "2026-03-01T00:00:00.000Z",
    periodEndExclusiveUtc: "2026-04-01T00:00:00.000Z",
  },
  ledger: {
    limitUsdMicros: 10_000_000,
    committedLiabilityUsdMicros: 1_000_000,
    heldReservationsUsdMicros: 500_000,
    unresolvedUncertainLiabilityUsdMicros: 250_000,
    overageUsdMicros: 50_000,
    budgetPolicyVersionId: "ibpv-1",
  },
  availableReservationCapacityUsdMicros: 8_200_000,
  liabilityAccountingKind: "ESTIMATED_RESERVATION_LIABILITY" as const,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Inference budget console B5.5C.1", () => {
  it("C1/C10/C12: lists policies, empty period state, no activation controls", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies") && method === "GET") {
        return json({
          policies: [
            {
              id: "ibp-1",
              workspaceId: "ws-1",
              key: "default",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({
          ...periodUsageWithLedger,
          ledger: null,
          availableReservationCapacityUsdMicros: null,
        });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");

    await waitFor(() => {
      expect(screen.getByTestId("inference-budget-page")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "default" })).toBeTruthy();
    expect(
      screen.getByTestId("inference-budget-enforcement-disabled"),
    ).toBeTruthy();
    expect(screen.getByTestId("inference-budget-period-empty")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText(/enable budget/i)).toBeNull();
  });

  it("C2: ADMIN can create a policy", async () => {
    const user = userEvent.setup();
    let policiesList: Array<{
      id: string;
      workspaceId: string;
      key: string;
      createdAt: string;
    }> = [];
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies") && method === "GET") {
        return json({ policies: policiesList });
      }
      if (url.includes("/inference-budget-policies") && method === "POST") {
        const created = {
          id: "ibp-new",
          workspaceId: "ws-1",
          key: "planning",
          createdAt: "2026-03-02T00:00:00.000Z",
        };
        policiesList = [created];
        return json(
          {
            policy: created,
            version: {
              id: "ibpv-new",
              policyId: "ibp-new",
              workspaceId: "ws-1",
              version: 1,
              definition: {
                ...createDefaultInferenceBudgetPolicyDefinition(),
                periodLimitUsdMicros: 100_000_000,
              },
              createdAt: "2026-03-02T00:00:00.000Z",
            },
          },
          201,
        );
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");
    await waitFor(() =>
      expect(screen.getByLabelText(/Policy key/i)).toBeTruthy(),
    );
    await user.type(screen.getByLabelText(/Policy key/i), "planning");
    await user.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "planning" })).toBeTruthy();
    });
  });

  it("C3: VIEWER cannot create a policy", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies") && method === "GET") {
        return json({ policies: [] });
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");
    await waitFor(() => {
      expect(screen.getByText(/Read-only access/i)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Create policy" })).toBeNull();
  });

  it("C7/C8/C9: ledger fields match API including uncertain and overage", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
      if (url.includes("/inference-budget-policies")) {
        return json({ policies: [] });
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (
        url.includes("/workspace-inference-budget/period-usage") &&
        !url.includes("periodKey=2026-02")
      ) {
        return json(periodUsageWithLedger);
      }
      if (url.includes("periodKey=2026-02")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");

    await waitFor(() => {
      expect(
        screen.getByTestId("inference-budget-uncertain-liability"),
      ).toBeTruthy();
    });
    expect(
      screen.getByTestId("inference-budget-overage").textContent,
    ).toContain("$0.05");
    expect(screen.getByText(/Estimated committed liability/i)).toBeTruthy();
  });

  it("C4/C5: ADMIN can append version; history shown on detail page", async () => {
    const user = userEvent.setup();
    let versions = [
      {
        id: "ibpv-1",
        policyId: "ibp-1",
        workspaceId: "ws-1",
        version: 1,
        definition: {
          ...createDefaultInferenceBudgetPolicyDefinition(),
          periodLimitUsdMicros: 10_000_000,
        },
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ];
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies/ibp-1/versions")) {
        if (method === "GET") {
          return json({ versions });
        }
        if (method === "POST") {
          versions = [
            ...versions,
            {
              id: "ibpv-2",
              policyId: "ibp-1",
              workspaceId: "ws-1",
              version: 2,
              definition: {
                ...createDefaultInferenceBudgetPolicyDefinition(),
                periodLimitUsdMicros: 12_000_000,
              },
              createdAt: "2026-03-02T00:00:00.000Z",
            },
          ];
          return json(versions[1], 201);
        }
      }
      if (url.endsWith("/inference-budget-policies") && method === "GET") {
        return json({
          policies: [
            {
              id: "ibp-1",
              workspaceId: "ws-1",
              key: "default",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget/ibp-1");
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Append version" }));
    await waitFor(() => {
      expect(screen.getByText("v2")).toBeTruthy();
    });
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("C11: surfaces API errors without false success", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies") && method === "GET") {
        return json({ policies: [] });
      }
      if (url.includes("/inference-budget-policies") && method === "POST") {
        return json({ error: "Forbidden." }, 403);
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");
    await waitFor(() =>
      expect(screen.getByLabelText(/Policy key/i)).toBeTruthy(),
    );
    await user.type(screen.getByLabelText(/Policy key/i), "denied");
    await user.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});

describe("Inference budget console B5.5C.3 activation", () => {
  it("ACT18/ACT20: ADMIN activation flow when mutations permitted", async () => {
    const user = userEvent.setup();
    let config = {
      ...defaultConfig,
      activationMutationsPermitted: true,
    };
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/inference-budget-policies/ibp-1/versions")) {
        return json({
          versions: [
            {
              id: "ibpv-1",
              policyId: "ibp-1",
              workspaceId: "ws-1",
              version: 1,
              definition: {
                ...createDefaultInferenceBudgetPolicyDefinition(),
                periodLimitUsdMicros: 10_000_000,
              },
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/inference-budget-policies") && method === "GET") {
        return json({
          policies: [
            {
              id: "ibp-1",
              workspaceId: "ws-1",
              key: "default",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (
        url.includes("/workspace-inference-budget/activate") &&
        method === "POST"
      ) {
        config = {
          activation: {
            enabled: true,
            activePolicyVersionId: "ibpv-1",
            updatedAt: "2026-03-02T00:00:00.000Z",
          },
          runtimePolicy: { enabled: true, policyVersionId: "ibpv-1" },
          activationMutationsPermitted: true,
        };
        return json(config);
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(config);
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget/ibp-1");
    await waitFor(() => {
      expect(
        screen.getByTestId("inference-budget-activate-ibpv-1"),
      ).toBeTruthy();
    });
    await user.click(screen.getByTestId("inference-budget-activate-ibpv-1"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Enable enforcement" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeTruthy();
    });
  });

  it("ACT19: VIEWER cannot activate", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
      if (url.includes("/inference-budget-policies/ibp-1/versions")) {
        return json({
          versions: [
            {
              id: "ibpv-1",
              policyId: "ibp-1",
              workspaceId: "ws-1",
              version: 1,
              definition: createDefaultInferenceBudgetPolicyDefinition(),
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/inference-budget-policies")) {
        return json({
          policies: [
            {
              id: "ibp-1",
              workspaceId: "ws-1",
              key: "default",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json({ ...defaultConfig, activationMutationsPermitted: true });
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget/ibp-1");
    await waitFor(() => {
      expect(screen.getByText("Read-only access")).toBeTruthy();
    });
    expect(screen.queryByTestId("inference-budget-activate-ibpv-1")).toBeNull();
  });

  it("ACT20: gate disabled — no functional activation controls", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/workspace-inference-budget/configuration")) {
        return json(defaultConfig);
      }
      if (url.includes("/inference-budget-policies")) {
        return json({ policies: [] });
      }
      if (url.includes("/workspace-inference-budget/period-usage")) {
        return json({ ...periodUsageWithLedger, ledger: null });
      }
      return undefined;
    });

    renderBudget("/settings/inference-budget");
    await waitFor(() => {
      expect(
        screen.getByTestId("inference-budget-activation-gate-disabled"),
      ).toBeTruthy();
    });
    expect(
      screen.queryByTestId("inference-budget-disable-enforcement"),
    ).toBeNull();
  });
});
