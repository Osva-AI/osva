import { describe, expect, it } from "vitest";

import { selectAvailablePublishPorts } from "../src/setup/port-selection.js";

describe("port selection", () => {
  it("keeps defaults when loopback ports are free", async () => {
    const probe = async (port: number) =>
      port === 8080 || port === 3100 || port === 4174
        ? ({ kind: "in_use" } as const)
        : ({ kind: "available" } as const);

    const selected = await selectAvailablePublishPorts({
      requested: {
        webPort: 8080,
        mcpPort: 3100,
        consolePort: 4174,
        runtimeCapabilityPort: 8787,
      },
      includeRuntimeCapability: false,
      reserved: new Set(),
      probe,
    });

    expect(selected.assignment.webPort).toBe(8081);
    expect(selected.assignment.mcpPort).toBe(3101);
    expect(selected.assignment.consolePort).toBe(4175);
    expect(selected.renumbered).toHaveLength(3);
  });
});
