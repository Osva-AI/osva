import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyConnectorsRootStdioFixtureEnvironment,
  isExternalConnectorIntegrationRequired,
  missingExternalConnectorFixtureMessage,
  resolveConnectorCheckoutNodeModulesForStdioEntry,
  resolveExternalConnectorStdioEntry,
  stdioEntryHasConnectorFixtureDependencies,
} from "./resolve-external-connector-stdio-entry.js";

const ENV_KEYS = [
  "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
  "OSVA_CONNECTORS_ROOT",
  "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
  "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("resolveExternalConnectorStdioEntry", () => {
  let savedEnv: Record<string, string | undefined>;

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it("returns the first existing explicit path when fixture deps resolve", () => {
    savedEnv = saveEnv();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-connector-entry-"));
    const entry = path.join(dir, "stdio-fixture.js");
    fs.mkdirSync(path.join(dir, "node_modules", "@osva-ai", "connector-sdk"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        dir,
        "node_modules",
        "@osva-ai",
        "connector-sdk",
        "package.json",
      ),
      "{}\n",
      "utf8",
    );
    fs.writeFileSync(entry, "export {};\n", "utf8");
    process.env.OSVA_CONNECTOR_TEST_STDIO_ENTRY = entry;

    expect(
      resolveExternalConnectorStdioEntry({
        explicitPathEnvVars: ["OSVA_CONNECTOR_TEST_STDIO_ENTRY"],
      }),
    ).toBe(path.resolve(entry));
  });

  it("ignores an explicit path that exists but cannot resolve fixture deps", () => {
    savedEnv = saveEnv();
    const explicitOnly = fs.mkdtempSync(
      path.join(os.tmpdir(), "osva-connector-stale-"),
    );
    const staleEntry = path.join(explicitOnly, "stdio-fixture.js");
    fs.writeFileSync(staleEntry, "export {};\n", "utf8");
    process.env.OSVA_CONNECTOR_TEST_STDIO_ENTRY = staleEntry;

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "osva-connectors-root-"),
    );
    const relative = path.join(
      "packages",
      "github",
      "test",
      "fixtures",
      ".build",
      "stdio-github-fixture.js",
    );
    const built = path.join(root, relative);
    fs.mkdirSync(path.dirname(built), { recursive: true });
    fs.writeFileSync(built, "export {};\n", "utf8");
    process.env.OSVA_CONNECTORS_ROOT = root;

    expect(stdioEntryHasConnectorFixtureDependencies(staleEntry)).toBe(false);
    expect(
      resolveExternalConnectorStdioEntry({
        explicitPathEnvVars: ["OSVA_CONNECTOR_TEST_STDIO_ENTRY"],
        connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
        stdioFixtureRelativePathFromRoot: relative,
      }),
    ).toBe(path.resolve(built));
  });

  it("resolves from connectors root and relative fixture path", () => {
    savedEnv = saveEnv();
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "osva-connectors-root-"),
    );
    const relative = path.join(
      "packages",
      "demo",
      ".build",
      "stdio-fixture.js",
    );
    const built = path.join(root, relative);
    fs.mkdirSync(path.dirname(built), { recursive: true });
    fs.writeFileSync(built, "export {};\n", "utf8");
    process.env.OSVA_CONNECTORS_ROOT = root;

    expect(
      resolveExternalConnectorStdioEntry({
        explicitPathEnvVars: [],
        connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
        stdioFixtureRelativePathFromRoot: relative,
      }),
    ).toBe(path.resolve(built));
  });

  it("returns undefined when no path exists", () => {
    savedEnv = saveEnv();
    process.env.OSVA_CONNECTOR_TEST_STDIO_ENTRY = path.join(
      os.tmpdir(),
      "missing-stdio-fixture.js",
    );

    expect(
      resolveExternalConnectorStdioEntry({
        explicitPathEnvVars: ["OSVA_CONNECTOR_TEST_STDIO_ENTRY"],
      }),
    ).toBeUndefined();
  });
});

describe("isExternalConnectorIntegrationRequired", () => {
  let savedEnv: Record<string, string | undefined>;

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it("is true when any require env var is true", () => {
    savedEnv = saveEnv();
    process.env.OSVA_REQUIRE_CONNECTOR_INTEGRATION = "true";

    expect(
      isExternalConnectorIntegrationRequired([
        "OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION",
        "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
      ]),
    ).toBe(true);
  });
});

describe("resolveConnectorCheckoutNodeModulesForStdioEntry", () => {
  it("walks up from the entry directory to find node_modules", () => {
    const checkout = fs.mkdtempSync(
      path.join(os.tmpdir(), "osva-connectors-walk-"),
    );
    const entry = path.join(
      checkout,
      "packages",
      "github",
      "test",
      "fixtures",
      ".build",
      "stdio-fixture.js",
    );
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "export {};\n", "utf8");
    fs.mkdirSync(path.join(checkout, "node_modules"), { recursive: true });

    expect(resolveConnectorCheckoutNodeModulesForStdioEntry(entry)).toBe(
      path.join(checkout, "node_modules"),
    );
  });
});

describe("applyConnectorsRootStdioFixtureEnvironment", () => {
  it("sets connectors root and clears explicit stdio entry overrides", () => {
    const env = applyConnectorsRootStdioFixtureEnvironment(
      {
        OSVA_CONNECTORS_ROOT: "/old",
        OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY: "/stale",
        KEEP: "1",
      },
      {
        connectorsRoot: "C:\\osva-connectors",
        explicitPathEnvVars: [
          "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
          "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
        ],
        connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
      },
    );

    expect(env.OSVA_CONNECTORS_ROOT).toBe("C:\\osva-connectors");
    expect(env.OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY).toBeUndefined();
    expect(env.KEEP).toBe("1");
  });
});

describe("missingExternalConnectorFixtureMessage", () => {
  it("includes connector label and env hints", () => {
    const message = missingExternalConnectorFixtureMessage({
      connectorLabel: "Example",
      buildInstructions: ["  pnpm build:test-stdio-fixture"],
      explicitPathEnvVars: ["OSVA_CONNECTOR_TEST_STDIO_ENTRY"],
      connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
      stdioFixtureRelativePathFromRoot: "packages/demo/.build/stdio-fixture.js",
    });

    expect(message).toContain("Example ToolGateway integration");
    expect(message).toContain("OSVA_CONNECTOR_TEST_STDIO_ENTRY");
    expect(message).toContain("OSVA_CONNECTORS_ROOT");
  });
});
