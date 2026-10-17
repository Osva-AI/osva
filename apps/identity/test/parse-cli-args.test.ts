import { describe, expect, it } from "vitest";

import {
  parseBootstrapCliArgs,
  parseRecoverCliArgs,
} from "../src/parse-cli-args.js";

describe("parseBootstrapCliArgs", () => {
  it("parses email, name, organization, and workspace ids", () => {
    const parsed = parseBootstrapCliArgs([
      "--email",
      "owner@example.com",
      "--name",
      "Initial Owner",
      "--organization-name",
      "Default Organization",
      "--workspace-id",
      "ws-a",
      "--workspace-id=ws-b",
    ]);

    expect(parsed.email).toBe("owner@example.com");
    expect(parsed.name).toBe("Initial Owner");
    expect(parsed.organizationName).toBe("Default Organization");
    expect(parsed.workspaceIds).toEqual(["ws-a", "ws-b"]);
    expect(parsed.allUnlinkedWorkspaces).toBe(false);
  });

  it("parses --all-unlinked-workspaces", () => {
    const parsed = parseBootstrapCliArgs([
      "--email=owner@example.com",
      "--all-unlinked-workspaces",
    ]);
    expect(parsed.allUnlinkedWorkspaces).toBe(true);
  });
});

describe("parseRecoverCliArgs", () => {
  it("parses --email", () => {
    expect(parseRecoverCliArgs(["--email", "a@b.com"]).email).toBe("a@b.com");
    expect(parseRecoverCliArgs(["--email=a@b.com"]).email).toBe("a@b.com");
  });
});
