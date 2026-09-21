import {
  AUTHORIZATION_ACTIONS,
  COMMUNITY_EDITION_ROLES,
  type RequestPrincipal,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { authorize, rolePermitsAction } from "../src/authorization.js";
import { PermissionDeniedError } from "../src/security-errors.js";

const WORKSPACE = "ws-1" as RequestPrincipal["workspaceId"];

function principal(role: RequestPrincipal["role"]): RequestPrincipal {
  return {
    subjectId: "key-1" as RequestPrincipal["subjectId"],
    workspaceId: WORKSPACE,
    role,
    authenticationMethod: "API_KEY",
  };
}

describe("Community Edition authorization matrix", () => {
  it("maps fixed roles to READ/EXECUTE/WRITE/ADMIN actions", () => {
    const expectations: Readonly<
      Record<
        RequestPrincipal["role"],
        ReadonlySet<
          (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS]
        >
      >
    > = {
      [COMMUNITY_EDITION_ROLES.VIEWER]: new Set([AUTHORIZATION_ACTIONS.READ]),
      [COMMUNITY_EDITION_ROLES.OPERATOR]: new Set([
        AUTHORIZATION_ACTIONS.READ,
        AUTHORIZATION_ACTIONS.EXECUTE,
      ]),
      [COMMUNITY_EDITION_ROLES.EDITOR]: new Set([
        AUTHORIZATION_ACTIONS.READ,
        AUTHORIZATION_ACTIONS.EXECUTE,
        AUTHORIZATION_ACTIONS.WRITE,
      ]),
      [COMMUNITY_EDITION_ROLES.ADMIN]: new Set([
        AUTHORIZATION_ACTIONS.READ,
        AUTHORIZATION_ACTIONS.EXECUTE,
        AUTHORIZATION_ACTIONS.WRITE,
        AUTHORIZATION_ACTIONS.ADMIN,
      ]),
    };

    for (const [role, allowed] of Object.entries(expectations) as Array<
      [
        RequestPrincipal["role"],
        ReadonlySet<
          (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS]
        >,
      ]
    >) {
      for (const action of Object.values(AUTHORIZATION_ACTIONS)) {
        expect(rolePermitsAction(role, action)).toBe(allowed.has(action));
      }
    }
  });

  it("denies cross-workspace authorization", () => {
    expect(() =>
      authorize(
        principal(COMMUNITY_EDITION_ROLES.ADMIN),
        AUTHORIZATION_ACTIONS.READ,
        { kind: "workspace" },
        { workspaceId: "other-ws" as RequestPrincipal["workspaceId"] },
      ),
    ).toThrow(PermissionDeniedError);
  });
});
