import { describe, expect, it } from "vitest";

import {
  ContainerCapabilityUrlError,
  isLoopbackCapabilityUrl,
  resolveContainerCapabilityBaseUrl,
  suggestContainerCapabilityBaseUrl,
  validateContainerCapabilityBaseUrl,
} from "../src/container-capability-url.js";

describe("container capability URL helpers", () => {
  it("suggests host.docker.internal on Docker Desktop platforms", () => {
    expect(suggestContainerCapabilityBaseUrl(8080, "win32")).toBe(
      "http://host.docker.internal:8080",
    );
    expect(suggestContainerCapabilityBaseUrl(8080, "darwin")).toBe(
      "http://host.docker.internal:8080",
    );
  });

  it("suggests the default Linux bridge gateway elsewhere", () => {
    expect(suggestContainerCapabilityBaseUrl(8080, "linux")).toBe(
      "http://172.17.0.1:8080",
    );
  });

  it("rejects loopback capability URLs for bridge containers", () => {
    expect(isLoopbackCapabilityUrl("http://127.0.0.1:8080")).toBe(true);
    expect(() =>
      validateContainerCapabilityBaseUrl("http://127.0.0.1:8080", "bridge"),
    ).toThrowError(ContainerCapabilityUrlError);
  });

  it("prefers explicit container capability URLs over runtime defaults", () => {
    expect(
      resolveContainerCapabilityBaseUrl({
        containerCapabilityBaseUrl: "http://host.docker.internal:8080/",
        runtimeCapabilityBaseUrl: "http://127.0.0.1:8080",
        suggestedBaseUrl: "http://172.17.0.1:8080",
      }),
    ).toBe("http://host.docker.internal:8080");
  });
});
