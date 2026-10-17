import type { OrganizationId } from "@osva-ai/contracts";

import type { Organization } from "../organization.js";

export interface OrganizationRepository {
  save(organization: Organization): Promise<void>;
  findById(id: OrganizationId): Promise<Organization | null>;
}
