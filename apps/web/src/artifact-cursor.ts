import type { ArtifactId } from "@osva/contracts";
import { artifactListCursorPayloadSchema } from "@osva/contracts/schemas";

export function encodeArtifactListCursor(cursor: {
  createdAt: Date;
  id: ArtifactId;
}): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeArtifactListCursor(
  encoded: string,
): { createdAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    const validated = artifactListCursorPayloadSchema.safeParse(parsed);
    if (!validated.success) {
      return null;
    }

    return validated.data;
  } catch {
    return null;
  }
}
