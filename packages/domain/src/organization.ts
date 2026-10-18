import type { OrganizationId } from "@osva-ai/contracts";
import { ORGANIZATION_NAME_MAX_LENGTH } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface OrganizationProps {
  readonly id: OrganizationId;
  readonly name: string;
  readonly createdAt: Date;
}

export class Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly createdAt: Date;

  private constructor(props: OrganizationProps) {
    this.id = props.id;
    this.name = props.name;
    this.createdAt = props.createdAt;
  }

  static create(props: OrganizationProps): Organization {
    if (!props.id) {
      throw new DomainInvariantError("Organization.id is required.");
    }

    const name = requireNonEmptyString(props.name, "Organization.name").trim();
    if (name.length > ORGANIZATION_NAME_MAX_LENGTH) {
      throw new DomainInvariantError(
        `Organization.name must be at most ${String(ORGANIZATION_NAME_MAX_LENGTH)} characters.`,
      );
    }

    return Object.freeze(
      new Organization({
        id: props.id,
        name,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
