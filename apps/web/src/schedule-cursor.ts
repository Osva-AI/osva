import { runListCursorPayloadSchema } from "@osva/contracts/schemas";

export function encodeScheduleListCursor(cursor: {
  readonly createdAt: string;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeScheduleListCursor(value: string): {
  readonly createdAt: string;
  readonly id: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const result = runListCursorPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function encodeScheduleOccurrenceListCursor(cursor: {
  readonly scheduledFor: string;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ scheduledFor: cursor.scheduledFor, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeScheduleOccurrenceListCursor(value: string): {
  readonly scheduledFor: string;
  readonly id: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("scheduledFor" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.scheduledFor !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }

    return {
      scheduledFor: parsed.scheduledFor,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}
