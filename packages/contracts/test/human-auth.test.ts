import { describe, expect, it } from "vitest";

import type { ApiKeyId, UserId, WorkspaceId } from "../src/ids.js";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
  type ApiKeyRequestPrincipal,
  type HumanSessionRequestPrincipal,
  isApiKeyRequestPrincipal,
  isHumanSessionRequestPrincipal,
  requestPrincipalRateLimitKey,
} from "../src/security.js";

describe("discriminated request principals", () => {
  it("narrows API key and human session principals", () => {
    const apiKey: ApiKeyRequestPrincipal = {
      authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
      subjectId: "ak-1" as ApiKeyId,
      workspaceId: "ws-1" as WorkspaceId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    };
    expect(isApiKeyRequestPrincipal(apiKey)).toBe(true);
    expect(isHumanSessionRequestPrincipal(apiKey)).toBe(false);

    const human: HumanSessionRequestPrincipal = {
      authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
      userId: "user-1" as UserId,
      sessionId: "sess-1",
    };
    expect(isHumanSessionRequestPrincipal(human)).toBe(true);
    expect(isApiKeyRequestPrincipal(human)).toBe(false);
    expect(requestPrincipalRateLimitKey(human)).toBe("user-1");
    expect(requestPrincipalRateLimitKey(apiKey)).toBe("ws-1:ak-1");
  });
});
