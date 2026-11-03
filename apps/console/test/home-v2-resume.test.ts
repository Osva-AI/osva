import { describe, expect, it } from "vitest";

import { selectHomeResumeTarget } from "../src/client/lib/home-v2-resume";

describe("selectHomeResumeTarget", () => {
  it("prefers the most recently updated workflow", () => {
    const target = selectHomeResumeTarget({
      agents: [],
      workflows: [
        {
          id: "w-old",
          workspaceId: "ws-1",
          key: "old",
          name: "Older flow",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "w-new",
          workspaceId: "ws-1",
          key: "new",
          name: "Newest flow",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
      ],
      recentRuns: [],
    });
    expect(target?.name).toBe("Newest flow");
    expect(target?.href).toContain("w-new");
  });
});
