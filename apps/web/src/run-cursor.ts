import { runListCursorPayloadSchema } from "@osva/contracts/schemas";

export function encodeRunListCursor(cursor: {
  readonly createdAt: string;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeRunListCursor(value: string): {
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
