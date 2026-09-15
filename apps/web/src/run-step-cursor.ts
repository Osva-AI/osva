import { runStepListCursorPayloadSchema } from "@osva/contracts/schemas";

export function encodeRunStepListCursor(cursor: {
  readonly startedAt: string;
  readonly id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ startedAt: cursor.startedAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeRunStepListCursor(value: string): {
  readonly startedAt: string;
  readonly id: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const result = runStepListCursorPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
