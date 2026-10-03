import { describe, expect, it } from "vitest";

import {
  approvalOperatorMountKey,
  shouldPreserveApprovalOperatorForm,
  simulatePollNodeDetailUpdate,
} from "../demo/public/node-detail-lifecycle.js";

const pendingApprovalNode = {
  key: "adoption-approval",
  presentationStatus: "WAITING",
  approval: { id: "apr-1", status: "PENDING" },
};

describe("approvalOperatorMountKey", () => {
  it("returns approval id only for pending approval wait", () => {
    expect(approvalOperatorMountKey(pendingApprovalNode)).toBe("apr-1");
    expect(
      approvalOperatorMountKey({
        ...pendingApprovalNode,
        approval: { id: "apr-1", status: "APPROVED" },
      }),
    ).toBeNull();
  });
});

describe("shouldPreserveApprovalOperatorForm", () => {
  it("preserves while same pending approval remains selected", () => {
    expect(
      shouldPreserveApprovalOperatorForm(
        "adoption-approval",
        pendingApprovalNode,
        "apr-1",
      ),
    ).toBe(true);
  });

  it("does not preserve when approval id changes", () => {
    expect(
      shouldPreserveApprovalOperatorForm(
        "adoption-approval",
        pendingApprovalNode,
        "apr-other",
      ),
    ).toBe(false);
  });

  it("does not preserve when selected node changes", () => {
    expect(
      shouldPreserveApprovalOperatorForm(
        "analysis",
        pendingApprovalNode,
        "apr-1",
      ),
    ).toBe(false);
  });
});

describe("simulatePollNodeDetailUpdate", () => {
  it("keeps the same textarea element across multiple poll cycles", () => {
    const state = {
      statusEl: { innerHTML: "" },
      operatorEl: {
        firstChild: null as unknown,
        replaceChildren(node: unknown) {
          (this as { firstChild: unknown }).firstChild = node;
        },
      },
      textarea: null as object | null,
      mountedApprovalId: null as string | null,
    };

    const first = simulatePollNodeDetailUpdate(
      state,
      "adoption-approval",
      pendingApprovalNode,
    );
    expect(first.preserved).toBe(false);

    const second = simulatePollNodeDetailUpdate(
      state,
      "adoption-approval",
      pendingApprovalNode,
    );
    const third = simulatePollNodeDetailUpdate(
      state,
      "adoption-approval",
      pendingApprovalNode,
    );

    expect(second.preserved).toBe(true);
    expect(third.preserved).toBe(true);
    expect(second.textarea).toBe(first.textarea);
    expect(third.textarea).toBe(first.textarea);
  });

  it("replaces textarea when approval leaves PENDING", () => {
    const state = {
      statusEl: { innerHTML: "" },
      operatorEl: {
        firstChild: null as unknown,
        replaceChildren(node: unknown) {
          (this as { firstChild: unknown }).firstChild = node;
        },
      },
      textarea: null as object | null,
      mountedApprovalId: null as string | null,
    };

    const first = simulatePollNodeDetailUpdate(
      state,
      "adoption-approval",
      pendingApprovalNode,
    );
    const decided = simulatePollNodeDetailUpdate(state, "adoption-approval", {
      ...pendingApprovalNode,
      approval: { id: "apr-1", status: "APPROVED" },
    });

    expect(decided.preserved).toBe(false);
    expect(decided.textarea).not.toBe(first.textarea);
  });
});
