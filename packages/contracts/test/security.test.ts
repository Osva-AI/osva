import { describe, expect, it } from "vitest";

import {
  AUTHORIZATION_ACTIONS,
  COMMUNITY_EDITION_ROLES,
  PUBLIC_API_ERROR_CODES,
} from "../src/security.js";

describe("security contracts", () => {
  it("freezes Community Edition roles and authorization actions", () => {
    expect(Object.keys(COMMUNITY_EDITION_ROLES).sort()).toEqual([
      "ADMIN",
      "EDITOR",
      "OPERATOR",
      "VIEWER",
    ]);
    expect(Object.keys(AUTHORIZATION_ACTIONS).sort()).toEqual([
      "ADMIN",
      "EXECUTE",
      "READ",
      "WRITE",
    ]);
  });

  it("defines stable public authentication and authorization error codes", () => {
    expect(PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED).toBe(
      "AUTHENTICATION_REQUIRED",
    );
    expect(PUBLIC_API_ERROR_CODES.PERMISSION_DENIED).toBe("PERMISSION_DENIED");
    expect(PUBLIC_API_ERROR_CODES.REQUEST_TOO_LARGE).toBe("REQUEST_TOO_LARGE");
  });
});
