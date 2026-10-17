import type { UserId } from "@osva-ai/contracts";
import {
  USER_DISPLAY_NAME_MAX_LENGTH,
  USER_EMAIL_MAX_LENGTH,
  USER_STATUSES,
  normalizeUserEmail,
  type UserStatus,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface UserProps {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

export class User {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly createdAt: Date;

  private constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.displayName = props.displayName;
    this.status = props.status;
    this.createdAt = props.createdAt;
  }

  static create(props: UserProps): User {
    if (!props.id) {
      throw new DomainInvariantError("User.id is required.");
    }

    const email = normalizeUserEmail(
      requireNonEmptyString(props.email, "User.email"),
    );
    if (email.length > USER_EMAIL_MAX_LENGTH) {
      throw new DomainInvariantError(
        `User.email must be at most ${String(USER_EMAIL_MAX_LENGTH)} characters.`,
      );
    }
    if (!email.includes("@")) {
      throw new DomainInvariantError("User.email must contain '@'.");
    }

    const displayName = requireNonEmptyString(
      props.displayName,
      "User.displayName",
    ).trim();
    if (displayName.length > USER_DISPLAY_NAME_MAX_LENGTH) {
      throw new DomainInvariantError(
        `User.displayName must be at most ${String(USER_DISPLAY_NAME_MAX_LENGTH)} characters.`,
      );
    }

    if (
      props.status !== USER_STATUSES.PENDING_SETUP &&
      props.status !== USER_STATUSES.ACTIVE &&
      props.status !== USER_STATUSES.DISABLED
    ) {
      throw new DomainInvariantError("User.status is invalid.");
    }

    return Object.freeze(
      new User({
        id: props.id,
        email,
        displayName,
        status: props.status,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
