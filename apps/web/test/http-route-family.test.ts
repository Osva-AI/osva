import { describe, expect, it } from "vitest";

import {
  classifyHttpMethod,
  classifyHttpRouteFamily,
  classifyHttpStatusClass,
  isProbeRouteFamily,
} from "../src/http-route-family.js";

describe("HTTP route family classification", () => {
  it("uses bounded families instead of raw dynamic paths", () => {
    expect(classifyHttpRouteFamily("/health")).toBe("health");
    expect(classifyHttpRouteFamily("/ready")).toBe("ready");
    expect(classifyHttpRouteFamily("/v1/runs/abc-123/attempts/def")).toBe(
      "v1.runs",
    );
    expect(classifyHttpRouteFamily("/v1/workflow-events")).toBe(
      "v1.workflow_events",
    );
    expect(classifyHttpRouteFamily("/v1/workflow-runs/wr-1")).toBe(
      "v1.workflows",
    );
    expect(classifyHttpRouteFamily("/v1/approval-requests/ar-1/decision")).toBe(
      "v1.approvals",
    );
    expect(classifyHttpRouteFamily("/v1/knowledge-sources/ks-1")).toBe(
      "v1.knowledge",
    );
    expect(classifyHttpRouteFamily("/v1/unknown-resource/xyz")).toBe(
      "v1.other",
    );
    expect(classifyHttpRouteFamily("/not-api")).toBe("other");
  });

  it("classifies methods and status classes", () => {
    expect(classifyHttpMethod("post")).toBe("POST");
    expect(classifyHttpMethod("TRACE")).toBe("OTHER");
    expect(classifyHttpStatusClass(201)).toBe("2xx");
    expect(classifyHttpStatusClass(429)).toBe("4xx");
    expect(classifyHttpStatusClass(503)).toBe("5xx");
    expect(isProbeRouteFamily("health")).toBe(true);
    expect(isProbeRouteFamily("v1.runs")).toBe(false);
  });
});
