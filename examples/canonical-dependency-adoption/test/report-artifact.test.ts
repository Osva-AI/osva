import { describe, expect, it, vi } from "vitest";

import {
  DemoReportArtifactError,
  resolveCanonicalReportArtifact,
} from "../demo/report-artifact.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import { validReportOutput, validWorkflowInput } from "./fixtures.js";

const REPORT_RUN_ID = "run-report-1";
const ARTIFACT_ID = "b9f85539-4163-401b-a69f-0ffce57e8c21";

describe("resolveCanonicalReportArtifact", () => {
  it("extracts artifact id from report child run output, not arbitrary input", async () => {
    const get = vi.fn(async () => ({
      id: ARTIFACT_ID,
      workspaceId: "ws-1",
      name: "report.md",
      mediaType: "text/markdown",
      sizeBytes: 12,
      digest: "sha256:" + "a".repeat(64),
      metadata: {},
      producer: { runId: REPORT_RUN_ID, runAttemptId: "ra-1" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const api = {
      sdk: {
        runs: {
          listAttempts: vi.fn(async () => ({
            attempts: [
              {
                id: "ra-1",
                sequence: 1,
                status: "SUCCEEDED",
                output: {
                  ...validReportOutput,
                  artifact: { type: "artifact", artifactId: ARTIFACT_ID },
                },
              },
            ],
          })),
        },
        artifacts: { get },
      },
    } as unknown as OperatorApi;

    const run = {
      id: "wfr-1",
      status: "SUCCEEDED",
      output: {
        ...validReportOutput,
        artifact: { type: "artifact", artifactId: ARTIFACT_ID },
      },
      nodeRuns: [
        {
          id: "wnr-report",
          workflowNodeKey: "report",
          status: "SUCCEEDED",
          childRunId: REPORT_RUN_ID,
        },
      ],
      input: validWorkflowInput,
    };

    const resolved = await resolveCanonicalReportArtifact(api, run as never);
    expect(resolved.artifactId).toBe(ARTIFACT_ID);
    expect(get).toHaveBeenCalledWith(ARTIFACT_ID);
  });

  it("throws when report node output lacks artifact reference", async () => {
    const api = {
      sdk: {
        runs: {
          listAttempts: vi.fn(async () => ({
            attempts: [
              {
                id: "ra-1",
                sequence: 1,
                status: "SUCCEEDED",
                output: { schemaVersion: "1", summary: "no artifact" },
              },
            ],
          })),
        },
        artifacts: { get: vi.fn() },
      },
    } as unknown as OperatorApi;

    const run = {
      id: "wfr-1",
      status: "SUCCEEDED",
      nodeRuns: [
        {
          id: "wnr-report",
          workflowNodeKey: "report",
          status: "SUCCEEDED",
          childRunId: REPORT_RUN_ID,
        },
      ],
    };

    await expect(
      resolveCanonicalReportArtifact(api, run as never),
    ).rejects.toBeInstanceOf(DemoReportArtifactError);
  });
});
