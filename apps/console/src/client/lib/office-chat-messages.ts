import type { OfficeMessageResource } from "../hooks/use-office-collaboration";

/** Merge paged messages with stable sequence order and no duplicate ids. */
export function flattenOfficeThreadMessages(
  pages: readonly { items: readonly OfficeMessageResource[] }[] | undefined,
): readonly OfficeMessageResource[] {
  if (pages === undefined) {
    return [];
  }
  const byId = new Map<string, OfficeMessageResource>();
  for (const page of pages) {
    for (const message of page.items) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
