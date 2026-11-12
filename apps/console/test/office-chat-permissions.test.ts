import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { roleCanAuthorOfficeChat } from "../src/client/lib/permissions";

describe("office chat authoring (M22.2A WRITE contract)", () => {
  it("permits DEVELOPER and above to author messages", () => {
    expect(roleCanAuthorOfficeChat(HUMAN_WORKSPACE_ROLES.DEVELOPER)).toBe(true);
    expect(roleCanAuthorOfficeChat(HUMAN_WORKSPACE_ROLES.ADMIN)).toBe(true);
    expect(roleCanAuthorOfficeChat(HUMAN_WORKSPACE_ROLES.OWNER)).toBe(true);
  });

  it("denies VIEWER and OPERATOR (READ/EXECUTE without WRITE)", () => {
    expect(roleCanAuthorOfficeChat(HUMAN_WORKSPACE_ROLES.VIEWER)).toBe(false);
    expect(roleCanAuthorOfficeChat(HUMAN_WORKSPACE_ROLES.OPERATOR)).toBe(false);
  });
});
