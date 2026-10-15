import { describe, expect, it } from "vitest";

import {
  parseComposeProjectNameField,
  resolveComposeProjectName,
} from "../scripts/lib/compose-project.js";

describe("Compose project resolution", () => {
  it("prefers OSVA_COMPOSE_PROJECT over file and defaults", () => {
    expect(
      resolveComposeProjectName({
        osvaComposeProject: "custom-project",
        composeProjectNameEnv: "from-env",
        composeFileNameField: "from-file",
      }),
    ).toBe("custom-project");
  });

  it("uses COMPOSE_PROJECT_NAME when explicit override is absent", () => {
    expect(
      resolveComposeProjectName({
        composeProjectNameEnv: "my-stack",
        composeFileNameField: "osva-self-hosted",
      }),
    ).toBe("my-stack");
  });

  it("reads the top-level name field from compose.yml", () => {
    expect(
      parseComposeProjectNameField("name: osva-self-hosted\n\nservices:\n"),
    ).toBe("osva-self-hosted");
  });

  it("falls back to osva-self-hosted when nothing is configured", () => {
    expect(resolveComposeProjectName({})).toBe("osva-self-hosted");
  });
});
