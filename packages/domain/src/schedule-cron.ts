import { CronExpressionParser } from "cron-parser";

import { DomainInvariantError } from "./errors.js";

const FIVE_FIELD_CRON_PARTS = 5;

export function assertValidFiveFieldCronExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new DomainInvariantError("Schedule.cronExpression is required.");
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== FIVE_FIELD_CRON_PARTS) {
    throw new DomainInvariantError(
      "Schedule.cronExpression must use five fields: minute hour day-of-month month day-of-week.",
    );
  }

  try {
    CronExpressionParser.parse(trimmed, { tz: "UTC" });
  } catch {
    throw new DomainInvariantError("Schedule.cronExpression is invalid.");
  }

  return trimmed;
}

export function assertValidIanaTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  if (trimmed.length === 0) {
    throw new DomainInvariantError("Schedule.timezone is required.");
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    throw new DomainInvariantError(
      "Schedule.timezone must be a valid IANA name.",
    );
  }

  return trimmed;
}

export function nextCronInstantAfter(
  cronExpression: string,
  timezone: string,
  after: Date,
): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    tz: timezone,
    currentDate: after,
  });
  return interval.next().toDate();
}
