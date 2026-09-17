import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OSVA_ATTR, OSVA_SPAN } from "@osva/observability";

import {
  createInMemoryOpenTelemetryHarness,
  type InMemoryOpenTelemetryHarness,
} from "../src/testing/index.js";

describe("OpenTelemetryInstrumentation", () => {
  let harness: InMemoryOpenTelemetryHarness;

  beforeAll(async () => {
    harness = await createInMemoryOpenTelemetryHarness();
  });

  afterAll(async () => {
    await harness.shutdown();
  });

  it("does not capture prompt or secret payload attributes", async () => {
    await harness.instrumentation.withSpan(
      OSVA_SPAN.MODEL_GENERATE_TEXT,
      {
        [OSVA_ATTR.RUN_ID]: "run-1",
        [OSVA_ATTR.PROVIDER]: "OPENAI",
      },
      async () => undefined,
    );

    const span = harness.spanExporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === OSVA_SPAN.MODEL_GENERATE_TEXT);
    const attributeKeys = Object.keys(span?.attributes ?? {});
    expect(attributeKeys).not.toContain("prompt");
    expect(attributeKeys).not.toContain("messages");
    expect(attributeKeys).not.toContain("authorization");
    expect(attributeKeys).not.toContain("api_key");
  });

  it("propagates trace context through inject and extract", async () => {
    let injectedTraceparent: string | undefined;
    let extractedTraceparent: string | undefined;

    await harness.instrumentation.withSpan(
      OSVA_SPAN.RUN_CREATE,
      { [OSVA_ATTR.RUN_ID]: "run-parent" },
      async () => {
        injectedTraceparent =
          harness.instrumentation.injectTraceContext()?.traceparent;
        await harness.instrumentation.runWithExtractedContext(
          harness.instrumentation.injectTraceContext(),
          async () => {
            extractedTraceparent =
              harness.instrumentation.injectTraceContext()?.traceparent;
          },
        );
      },
    );

    expect(injectedTraceparent).toMatch(/^00-/);
    expect(extractedTraceparent).toBe(injectedTraceparent);
  });
});
