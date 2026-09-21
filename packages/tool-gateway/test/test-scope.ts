import type {
  ApiKeyId,
  CommunityEditionRole,
  WorkspaceId,
} from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import type { ControlPlaneScope } from "@osva/domain";

export function fakeControlPlaneScope(
  workspaceId: WorkspaceId,
  role: CommunityEditionRole = COMMUNITY_EDITION_ROLES.ADMIN,
): ControlPlaneScope {
  return {
    principal: {
      subjectId: "ak-test" as ApiKeyId,
      workspaceId,
      role,
      authenticationMethod: "API_KEY",
    },
  };
}
