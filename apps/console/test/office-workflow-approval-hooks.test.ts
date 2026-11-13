import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createElement } from "react";

import { workspaceMutationFetch } from "../src/client/lib/console-api";
import { useApprovalDecisionMutation } from "../src/client/hooks/use-workflow-runs";

const invalidateQueries = vi.fn();

vi.mock("../src/client/lib/console-api", () => ({
  workspaceMutationFetch: vi.fn(),
}));

vi.mock("../src/client/hooks/use-workspace-query-scope", () => ({
  useWorkspaceQueryScope: () => "ws-1",
}));

function wrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient();
  client.invalidateQueries = invalidateQueries as never;
  return createElement(QueryClientProvider, { client }, children);
}

describe("useApprovalDecisionMutation", () => {
  it("invalidates workflow and office queries on success", async () => {
    vi.mocked(workspaceMutationFetch).mockResolvedValue({
      id: "apr-1",
      workspaceId: "ws-1",
      workflowRunId: "wfr-1",
      workflowNodeRunId: "nr-1",
      status: "APPROVED",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    invalidateQueries.mockClear();
    const { result } = renderHook(
      () => useApprovalDecisionMutation("wfr-1", { assignmentId: "asn-1" }),
      { wrapper },
    );

    await result.current.mutateAsync({
      approvalRequestId: "apr-1",
      decision: "APPROVED",
    });

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());

    const keys = invalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: readonly unknown[] }).queryKey,
    );
    expect(keys).toContainEqual(["workflow-runs", "ws-1", "wfr-1"]);
    expect(keys).toContainEqual(["office", "ws-1", "inbox"]);
    expect(keys).toContainEqual(["office", "ws-1", "assignments", "asn-1"]);
  });
});
