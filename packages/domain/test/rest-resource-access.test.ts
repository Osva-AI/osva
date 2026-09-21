import type { WorkspaceId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  REST_RESOURCE_ACCESS_OUTCOME,
  classifyRestResourceAccess,
} from "../src/rest-resource-access.js";

describe("classifyRestResourceAccess", () => {
  const principalWorkspaceId = "ws-a" as WorkspaceId;
  const foreignWorkspaceId = "ws-b" as WorkspaceId;

  it("maps missing and foreign workspace resources to not_found", () => {
    expect(
      classifyRestResourceAccess({
        principalWorkspaceId,
        resourceWorkspaceId: undefined,
        authorized: false,
      }),
    ).toBe(REST_RESOURCE_ACCESS_OUTCOME.NOT_FOUND);

    expect(
      classifyRestResourceAccess({
        principalWorkspaceId,
        resourceWorkspaceId: foreignWorkspaceId,
        authorized: false,
      }),
    ).toBe(REST_RESOURCE_ACCESS_OUTCOME.NOT_FOUND);
  });

  it("maps in-workspace authorization failures to permission_denied", () => {
    expect(
      classifyRestResourceAccess({
        principalWorkspaceId,
        resourceWorkspaceId: principalWorkspaceId,
        authorized: false,
      }),
    ).toBe(REST_RESOURCE_ACCESS_OUTCOME.PERMISSION_DENIED);
  });

  it("maps authorized in-workspace access to granted", () => {
    expect(
      classifyRestResourceAccess({
        principalWorkspaceId,
        resourceWorkspaceId: principalWorkspaceId,
        authorized: true,
      }),
    ).toBe(REST_RESOURCE_ACCESS_OUTCOME.GRANTED);
  });
});
