import type { HumanWorkspacePermission } from "./human-identity.js";
import type { AuthorizationAction } from "./security.js";

import type { V1RouteAccessClass } from "./v1-control-plane-human-access.js";

export interface V1RouteAccessRecord {
  readonly module: string;
  readonly method: string;
  readonly path: string;
  readonly accessClass: V1RouteAccessClass;
  readonly workspaceScoped: boolean;
  readonly requiredHumanPermission: HumanWorkspacePermission | null;
  readonly requiredAuthorizationAction: AuthorizationAction | null;
  readonly resourceFamily: string;
}
