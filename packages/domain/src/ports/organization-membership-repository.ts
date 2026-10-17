import type {
  OrganizationId,
  OrganizationMembershipId,
  UserId,
} from "@osva-ai/contracts";

import type { OrganizationMembership } from "../organization-membership.js";

export interface OrganizationMembershipRepository {
  save(membership: OrganizationMembership): Promise<void>;
  findById(
    id: OrganizationMembershipId,
  ): Promise<OrganizationMembership | null>;
  findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | null>;
}
