import { describe, expect, it } from "vitest";

import { composeBaseArgs } from "../src/setup/compose-exec.js";
import {
  buildInstallEnvValues,
  renderInstallEnvFile,
} from "../src/setup/env-file.js";
import { readSetupOptions } from "../src/setup/read-options.js";
import {
  DEFAULT_RUNTIME_CAPABILITY_PORT,
  isRemoteHttpDevProfileEnabled,
  runtimeCapabilityBaseUrlForPort,
} from "../src/setup/remote-http-dev.js";

describe("remote-http-dev installation profile", () => {
  it("defaults capability port and reads setup flags", () => {
    expect(
      readSetupOptions({ "remote-http-dev": true }, {}, "linux"),
    ).toMatchObject({
      remoteHttpDev: true,
      runtimeCapabilityPort: DEFAULT_RUNTIME_CAPABILITY_PORT,
    });
    expect(
      readSetupOptions({}, { OSVA_SETUP_REMOTE_HTTP_DEV: "1" }, "linux"),
    ).toMatchObject({ remoteHttpDev: true });
  });

  it("rejects duplicate publish ports when remote-http-dev is enabled", () => {
    expect(() =>
      readSetupOptions(
        {
          "remote-http-dev": true,
          "web-port": "8787",
          "runtime-capability-port": "8787",
        },
        {},
      ),
    ).toThrow(/distinct|8787/i);
  });

  it("does not enable private-network flags in default install env rendering", () => {
    const values = buildInstallEnvValues({
      imageRef: "ghcr.io/osva-ai/osva:1.1.1",
      composeProjectName: "osva-test",
      webPort: 8080,
      mcpPort: 3100,
      consolePort: 4174,
      runtimeCapabilityPort: 8787,
      remoteHttpDevProfile: false,
      generateSecret: () => "a".repeat(64),
    });
    const rendered = renderInstallEnvFile(values);
    expect(rendered).not.toContain(
      "OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS=true",
    );
    expect(rendered).not.toMatch(/OSVA_RUNTIME_CAPABILITY_SECRET=[0-9a-f]/);
  });

  it("generates capability wiring when the profile is enabled", () => {
    const values = buildInstallEnvValues({
      imageRef: "ghcr.io/osva-ai/osva:1.1.1",
      composeProjectName: "osva-test",
      webPort: 8080,
      mcpPort: 3100,
      consolePort: 4174,
      runtimeCapabilityPort: 8787,
      remoteHttpDevProfile: true,
      generateSecret: () => "b".repeat(64),
    });
    expect(values.OSVA_RUNTIME_CAPABILITY_BASE_URL).toBe(
      runtimeCapabilityBaseUrlForPort(8787),
    );
    const rendered = renderInstallEnvFile(values);
    expect(rendered).toContain(
      "OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS=true",
    );
    expect(rendered).toContain(
      `OSVA_RUNTIME_CAPABILITY_SECRET=${"b".repeat(64)}`,
    );
  });

  it("detects profile activation from installation env maps", () => {
    expect(
      isRemoteHttpDevProfileEnabled(
        new Map([["OSVA_REMOTE_HTTP_DEV_PROFILE", "true"]]),
      ),
    ).toBe(true);
    expect(
      isRemoteHttpDevProfileEnabled(
        new Map([["OSVA_REMOTE_HTTP_DEV_PROFILE", "false"]]),
      ),
    ).toBe(false);
  });

  it("keeps default compose args on production installs", () => {
    const args = composeBaseArgs({
      installDir: "/tmp/osva",
      envFilePath: "/tmp/osva/.env",
      projectName: "osva-test",
    });
    expect(args.some((arg) => arg.endsWith("compose.yml"))).toBe(true);
    expect(args.some((arg) => arg.includes("compose.remote-http-dev"))).toBe(
      false,
    );
  });
});
