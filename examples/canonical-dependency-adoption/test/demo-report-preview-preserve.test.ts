import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  reportArtifactPreserveKey,
  shouldPreserveReportArtifactPanel,
  simulatePollReportArtifactUpdate,
} from "../demo/public/node-detail-lifecycle.js";

const reportNode = {
  key: "report",
  persistedStatus: "SUCCEEDED",
};

const artifactA = { artifactId: "b9f85539-4163-401b-a69f-0ffce57e8c21" };
const artifactB = { artifactId: "00000000-0000-0000-0000-000000000001" };

const workflowRunId = "03b289e2-e19a-4bf2-a09b-7fc2e94bfeae";

describe("report artifact preview lifecycle", () => {
  it("forms stable preserve keys from workflow run and artifact id", () => {
    expect(
      reportArtifactPreserveKey(workflowRunId, reportNode, artifactA),
    ).toBe(`${workflowRunId}:${artifactA.artifactId}`);
  });

  it("preserves mounted panel while report artifact identity is unchanged", () => {
    const mounted = reportArtifactPreserveKey(
      workflowRunId,
      reportNode,
      artifactA,
    );
    expect(
      shouldPreserveReportArtifactPanel(
        "report",
        workflowRunId,
        reportNode,
        artifactA,
        mounted,
      ),
    ).toBe(true);
    expect(
      shouldPreserveReportArtifactPanel(
        "report",
        workflowRunId,
        reportNode,
        artifactB,
        mounted,
      ),
    ).toBe(false);
  });

  it("keeps the same preview element across poll cycles without refetch churn", () => {
    const state = {
      statusEl: { innerHTML: "" },
      operatorEl: {
        firstChild: null as unknown,
        replaceChildren(node: unknown) {
          (this as { firstChild: unknown }).firstChild = node;
        },
      },
      previewPre: null as { textContent: string } | null,
      mountedReportArtifactKey: null as string | null,
      fetchCount: 0,
    };

    const first = simulatePollReportArtifactUpdate(
      state,
      "report",
      workflowRunId,
      reportNode,
      artifactA,
    );
    expect(first.preserved).toBe(false);
    expect(first.fetchCount).toBe(1);

    (first.previewPre as { textContent: string }).textContent =
      "# Cached markdown";

    const second = simulatePollReportArtifactUpdate(
      state,
      "report",
      workflowRunId,
      reportNode,
      artifactA,
    );
    const third = simulatePollReportArtifactUpdate(
      state,
      "report",
      workflowRunId,
      reportNode,
      artifactA,
    );

    expect(second.preserved).toBe(true);
    expect(third.preserved).toBe(true);
    expect(second.fetchCount).toBe(1);
    expect(third.fetchCount).toBe(1);
    expect(second.previewPre).toBe(first.previewPre);
    expect(
      (third.previewPre as { textContent: string } | undefined)?.textContent,
    ).toBe("# Cached markdown");
  });

  it("rebuilds preview mount when artifact identity changes", () => {
    const state = {
      statusEl: { innerHTML: "" },
      operatorEl: {
        firstChild: null as unknown,
        replaceChildren(node: unknown) {
          (this as { firstChild: unknown }).firstChild = node;
        },
      },
      previewPre: null as { textContent: string } | null,
      mountedReportArtifactKey: null as string | null,
      fetchCount: 0,
    };

    const first = simulatePollReportArtifactUpdate(
      state,
      "report",
      workflowRunId,
      reportNode,
      artifactA,
    );
    const changed = simulatePollReportArtifactUpdate(
      state,
      "report",
      workflowRunId,
      reportNode,
      artifactB,
    );

    expect(changed.preserved).toBe(false);
    expect(changed.fetchCount).toBe(2);
    expect(changed.previewPre).not.toBe(first.previewPre);
  });
});

describe("report preview app wiring", () => {
  it("skips operator rebuild on poll when report artifact panel is preserved", async () => {
    const appJs = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../demo/public/app.js",
      ),
      "utf8",
    );
    expect(appJs).toContain("shouldPreserveReportArtifactPanel");
    expect(appJs).toContain("preserveReport");
    expect(appJs).toContain("reportPreviewContentByKey");
    expect(appJs).toMatch(
      /async function loadReportArtifactPreview[\s\S]*?reportPreviewContentByKey\.get/,
    );
  });
});
