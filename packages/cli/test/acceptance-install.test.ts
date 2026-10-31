import { describe, expect, it } from "vitest";

import {
  acceptanceInstallEnabled,
  resolveSetupImageRef,
} from "../src/setup/acceptance-install.js";

describe("acceptance install hooks", () => {
  it("requires OSVA_ACCEPTANCE_INSTALL=1 for acceptance hooks", () => {
    expect(acceptanceInstallEnabled({})).toBe(false);
    expect(acceptanceInstallEnabled({ OSVA_ACCEPTANCE_INSTALL: "1" })).toBe(
      true,
    );
  });

  it("uses OSVA_SETUP_LOCAL_IMAGE without changing distribution manifest pin", () => {
    expect(
      resolveSetupImageRef({
        distributionImageRef: "ghcr.io/osva-ai/osva:1.1.1",
        processEnv: { OSVA_SETUP_LOCAL_IMAGE: "osva/local-m16-2d:dev" },
      }),
    ).toBe("osva/local-m16-2d:dev");
    expect(
      resolveSetupImageRef({
        distributionImageRef: "ghcr.io/osva-ai/osva:1.1.1",
        processEnv: {},
      }),
    ).toBe("ghcr.io/osva-ai/osva:1.1.1");
  });
});
