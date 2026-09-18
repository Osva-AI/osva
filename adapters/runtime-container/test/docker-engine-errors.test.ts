import { describe, expect, it } from "vitest";

import { DockerContainerEngineOperationError } from "../src/docker-engine-errors.js";

describe("DockerContainerEngineOperationError", () => {
  it("names the failing Docker engine operation", () => {
    const error = new DockerContainerEngineOperationError(
      "start",
      "container-1",
      new Error("engine rejected start"),
    );
    expect(error.operation).toBe("start");
    expect(error.message).toContain("start");
    expect(error.message).toContain("container-1");
  });
});
