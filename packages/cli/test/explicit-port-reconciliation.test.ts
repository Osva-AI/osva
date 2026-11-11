import { afterEach, describe, expect, it, vi } from "vitest";

import type { PortOwnershipAssessment } from "../src/setup/port-ownership.js";
import * as portOwnership from "../src/setup/port-ownership.js";
import { resolveAutoPublishPorts } from "../src/setup/resolve-publish-ports.js";
import type { SetupOptions } from "../src/setup/read-options.js";

const baseOptions = (): SetupOptions => ({
  webPort: 51474,
  mcpPort: 51475,
  consolePort: 51476,
  runtimeCapabilityPort: 8787,
  remoteHttpDev: false,
  installDir: "C:\\osva-acceptance-install",
  preflightOnly: false,
  authorizeExisting: true,
  adminEmail: "admin@test.local",
  adminName: "Admin",
  organizationName: "Org",
  workspaceName: "Workspace",
  createBootstrapAdminApiKey: false,
  autoPorts: false,
});

function mockOwnership(
  assessment: PortOwnershipAssessment,
): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(portOwnership, "assessLoopbackPortOwnership")
    .mockResolvedValue(assessment);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("explicit port reconciliation", () => {
  const probeInUse = async () => ({ kind: "in_use" as const });

  it("allows explicit ports occupied by this installation when --yes", async () => {
    mockOwnership({
      ownership: "this_installation",
      detail: "Compose publishes 127.0.0.1:51474",
      composeProjectName: "osva-test",
    });
    await expect(
      resolveAutoPublishPorts({
        options: baseOptions(),
        explicit: { web: true, mcp: true, console: true, runtime: false },
        probe: probeInUse,
        autoPorts: false,
      }),
    ).resolves.toMatchObject({
      options: { webPort: 51474 },
    });
  });

  it("denies unknown ownership even with --yes", async () => {
    mockOwnership({
      ownership: "unknown",
      detail: "Port matches .env but publisher not verified",
    });
    await expect(
      resolveAutoPublishPorts({
        options: baseOptions(),
        explicit: { web: true, mcp: false, console: false, runtime: false },
        probe: probeInUse,
        autoPorts: false,
      }),
    ).rejects.toThrow(/unknown/);
  });

  it("denies other OSVA installation", async () => {
    mockOwnership({
      ownership: "other_osva_installation",
      detail: "project osva-other",
    });
    await expect(
      resolveAutoPublishPorts({
        options: baseOptions(),
        explicit: { web: true, mcp: false, console: false, runtime: false },
        probe: probeInUse,
        autoPorts: false,
      }),
    ).rejects.toThrow(/other_osva_installation/);
  });

  it("denies foreign application", async () => {
    mockOwnership({
      ownership: "foreign_application",
      detail: "non-Compose listener",
    });
    await expect(
      resolveAutoPublishPorts({
        options: baseOptions(),
        explicit: { web: true, mcp: false, console: false, runtime: false },
        probe: probeInUse,
        autoPorts: false,
      }),
    ).rejects.toThrow(/foreign_application/);
  });

  it("requires --yes when this installation owns an occupied explicit port", async () => {
    mockOwnership({ ownership: "this_installation", detail: "same project" });
    await expect(
      resolveAutoPublishPorts({
        options: { ...baseOptions(), authorizeExisting: false },
        explicit: { web: true, mcp: false, console: false, runtime: false },
        probe: probeInUse,
        autoPorts: false,
      }),
    ).rejects.toThrow(/--yes/);
  });
});
