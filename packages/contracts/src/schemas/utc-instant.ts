import { z } from "zod";

/**
 * Canonical UTC ISO-8601 instant.
 * Requires a `Z` suffix and rejects numeric offsets such as `+05:30`.
 */
export const UTC_ISO8601_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const utcIso8601TimestampSchema = z
  .string()
  .regex(
    UTC_ISO8601_INSTANT_PATTERN,
    "must be a UTC ISO-8601 timestamp ending with Z",
  );
