import type {
  ApiKeyId,
  CommunityEditionRole,
  WorkspaceId,
} from "@osva/contracts";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
} from "@osva/contracts";

import type { ControlPlaneScope } from "../src/control-plane.js";

export function fakeControlPlaneScope(
  workspaceId: WorkspaceId,
  role: CommunityEditionRole = COMMUNITY_EDITION_ROLES.ADMIN,
): ControlPlaneScope {
  return {
    principal: {
      subjectId: "test-api-key" as ApiKeyId,
      workspaceId,
      role,
      authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
    },
  };
}
