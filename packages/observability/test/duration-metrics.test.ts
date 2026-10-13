import { describe, expect, it } from "vitest";
import type {
  ExecutionRequest,
  ExecutionResult,
  RuntimeAdapter,
} from "@osva-ai/contracts";

import { createInstrumentedRuntimeAdapter } from "../src/instrument-runtime.js";
import { OSVA_METRIC } from "../src/metrics.js";
import { RecordingInstrumentation } from "../src/recording-instrumentation.js";

const REQUEST = {
  runId: "run-1",
  runAttemptId: "attempt-1",
  agentVersionId: "av-1",
  runtime: { type: "TRUSTED_TYPESCRIPT" },
} as ExecutionRequest;

describe("runtime duration metrics", () => {
  it("records runtime execute duration without aliasing run duration", async () => {
    const telemetry = new RecordingInstrumentation();
    const runtime: RuntimeAdapter = {
      async execute(): Promise<ExecutionResult> {
        return { status: "succeeded", output: { ok: true } };
      },
    };

    await createInstrumentedRuntimeAdapter(runtime, telemetry).execute(REQUEST);

    expect(
      telemetry.histogramsNamed(OSVA_METRIC.RUNTIME_EXECUTE_DURATION_MS),
    ).toHaveLength(1);
    expect(
      telemetry.histogramsNamed(OSVA_METRIC.RUNTIME_EXECUTE_DURATION_MS)[0]
        ?.attributes,
    ).toEqual({ runtime_kind: "TRUSTED_TYPESCRIPT" });
    expect(telemetry.histogramsNamed(OSVA_METRIC.RUN_DURATION_MS)).toHaveLength(
      0,
    );
    expect(
      telemetry.histogramsNamed(OSVA_METRIC.RUN_ATTEMPT_DURATION_MS),
    ).toHaveLength(0);
  });
});
