import { describe, expect, it } from "vitest";

import {
  acceptanceInstallEnabled,
  resolveSetupImageRef,
} from "../src/setup/acceptance-install.js";
import { loadComposeDistribution } from "../src/setup/distribution.js";

describe("acceptance install hooks", () => {
  it("requires OSVA_ACCEPTANCE_INSTALL=1 for acceptance hooks", () => {
    expect(acceptanceInstallEnabled({})).toBe(false);
    expect(acceptanceInstallEnabled({ OSVA_ACCEPTANCE_INSTALL: "1" })).toBe(
      true,
    );
  });

  it("uses OSVA_SETUP_LOCAL_IMAGE without changing distribution manifest pin", async () => {
    const distribution = await loadComposeDistribution();
    const pinned = distribution.manifest.imageRef;
    expect(
      resolveSetupImageRef({
        distributionImageRef: pinned,
        processEnv: { OSVA_SETUP_LOCAL_IMAGE: "osva/local-m16-2d:dev" },
      }),
    ).toBe("osva/local-m16-2d:dev");
    expect(
      resolveSetupImageRef({
        distributionImageRef: pinned,
        processEnv: {},
      }),
    ).toBe(pinned);
  });
});
