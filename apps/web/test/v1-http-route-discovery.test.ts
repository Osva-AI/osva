import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PROBE_SEGMENT,
  enumerateProbePathsFromHandlerSource,
  extractPathMatchRegexPatternBodies,
} from "./support/v1-http-route-discovery.js";

const webSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

const INFERENCE_ROUTING_DYNAMIC_PATHS = [
  `/v1/inference-routing-policy-versions/${PROBE_SEGMENT}`,
  `/v1/inference-routing-policies/${PROBE_SEGMENT}/versions`,
] as const;

function matchInferenceRoutingRouteFixture(
  layout: "multiline" | "singleline",
): string {
  if (layout === "multiline") {
    return `
function matchInferenceRoutingRoute(path: string) {
  const policyVersion = path.match(
    /^\\/v1\\/inference-routing-policy-versions\\/([^/]+)$/,
  );
  const appendVersion = path.match(
    /^\\/v1\\/inference-routing-policies\\/([^/]+)\\/versions$/,
  );
  return undefined;
}
`;
  }

  return `
function matchInferenceRoutingRoute(path: string) {
  const policyVersion = path.match(/^\\/v1\\/inference-routing-policy-versions\\/([^/]+)$/);
  const appendVersion = path.match(/^\\/v1\\/inference-routing-policies\\/([^/]+)\\/versions$/);
  return undefined;
}
`;
}

function pathsFromRoutingFixture(layout: "multiline" | "singleline"): string[] {
  return enumerateProbePathsFromHandlerSource(
    matchInferenceRoutingRouteFixture(layout),
  );
}

describe("v1-http-route-discovery", () => {
  it("discovers the same inference-routing paths for multiline and single-line path.match", () => {
    const multiline = pathsFromRoutingFixture("multiline");
    const singleline = pathsFromRoutingFixture("singleline");

    for (const expected of INFERENCE_ROUTING_DYNAMIC_PATHS) {
      expect(multiline).toContain(expected);
      expect(singleline).toContain(expected);
    }
    expect(multiline.sort()).toEqual(singleline.sort());
  });

  it("does not invent routes when path.match patterns are absent", () => {
    const source = `
function matchOtherRoute(path: string) {
  if (path === "/v1/inference-routing-policies/activate") {
    return {};
  }
}
`;
    const discovered = enumerateProbePathsFromHandlerSource(source);
    for (const dynamic of INFERENCE_ROUTING_DYNAMIC_PATHS) {
      expect(discovered).not.toContain(dynamic);
    }
    expect(discovered).toContain("/v1/inference-routing-policies/activate");
  });

  it("extracts regex bodies across whitespace between path.match( and the pattern", () => {
    const bodies = extractPathMatchRegexPatternBodies(`
const a = path.match(
  /^\\/v1\\/foo\\/([^/]+)$/,
);
const b = path.match(/^\\/v1\\/bar$/);
`);
    expect(bodies).toEqual(["^\\/v1\\/foo\\/([^/]+)$", "^\\/v1\\/bar$"]);
  });

  it("discovers inference-routing dynamic paths from the shipped handler source", () => {
    const source = fs.readFileSync(
      path.join(webSrc, "inference-routing-http.ts"),
      "utf8",
    );
    const discovered = enumerateProbePathsFromHandlerSource(source);
    for (const expected of INFERENCE_ROUTING_DYNAMIC_PATHS) {
      expect(discovered).toContain(expected);
    }
  });
});
