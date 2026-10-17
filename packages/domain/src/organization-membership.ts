import type {
  OrganizationId,
  OrganizationMembershipId,
  UserId,
} from "@osva-ai/contracts";
import type { OrganizationMembershipRole } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant } from "./internals.js";

export interface OrganizationMembershipProps {
  readonly id: OrganizationMembershipId;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly role: OrganizationMembershipRole;
  readonly createdAt: Date;
}

export class OrganizationMembership {
  readonly id: OrganizationMembershipId;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly role: OrganizationMembershipRole;
  readonly createdAt: Date;

  private constructor(props: OrganizationMembershipProps) {
    this.id = props.id;
    this.organizationId = props.organizationId;
    this.userId = props.userId;
    this.role = props.role;
    this.createdAt = props.createdAt;
  }

  static create(props: OrganizationMembershipProps): OrganizationMembership {
    if (!props.id) {
      throw new DomainInvariantError("OrganizationMembership.id is required.");
    }
    if (!props.organizationId) {
      throw new DomainInvariantError(
        "OrganizationMembership.organizationId is required.",
      );
    }
    if (!props.userId) {
      throw new DomainInvariantError(
        "OrganizationMembership.userId is required.",
      );
    }

    return Object.freeze(
      new OrganizationMembership({
        id: props.id,
        organizationId: props.organizationId,
        userId: props.userId,
        role: props.role,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }

  withRole(role: OrganizationMembershipRole): OrganizationMembership {
    return OrganizationMembership.create({
      id: this.id,
      organizationId: this.organizationId,
      userId: this.userId,
      role,
      createdAt: this.createdAt,
    });
  }
}
