import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";

const EXECUTE_ROLES = new Set<string>([
  COMMUNITY_EDITION_ROLES.OPERATOR,
  COMMUNITY_EDITION_ROLES.EDITOR,
  COMMUNITY_EDITION_ROLES.ADMIN,
]);

export function roleCanExecuteControlPlaneActions(role: string): boolean {
  return EXECUTE_ROLES.has(role);
}
