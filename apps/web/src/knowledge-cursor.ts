import type { KnowledgeIndexId, KnowledgeSourceId } from "@osva/contracts";
import { knowledgeListCursorPayloadSchema } from "@osva/contracts/schemas";

export function encodeKnowledgeListCursor(cursor: {
  createdAt: Date;
  id: KnowledgeSourceId | KnowledgeIndexId;
}): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeKnowledgeListCursor(
  encoded: string,
): { createdAt: Date; id: string } | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    const validated = knowledgeListCursorPayloadSchema.safeParse(parsed);
    if (!validated.success) {
      return undefined;
    }

    return {
      createdAt: new Date(validated.data.createdAt),
      id: validated.data.id,
    };
  } catch {
    return undefined;
  }
}
