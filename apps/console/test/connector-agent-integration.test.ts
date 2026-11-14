import { describe, expect, it } from "vitest";

import {
  buildAgentPickerHandoffPath,
  buildAgentVersionCreateHandoffPath,
  buildPreselectedBindingRows,
  parseToolVersionHandoffParam,
  relatedExampleDocLinks,
  validateToolVersionHandoff,
} from "../src/client/lib/connector-agent-handoff";
import {
  collectToolBindingValidationIssues,
  describeToolBindingNameError,
  suggestBindingNameForRemoteTool,
} from "../src/client/lib/agent-tool-bindings";
import { describeRunStepToolErrorGuidance } from "../src/client/lib/execution-diagnostics";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";

const catalog = [
  {
    tool: {
      id: "tool-1",
      workspaceId: "ws-1",
      key: "search_npm",
      name: "Search npm",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    versions: [
      {
        id: "tv-1",
        toolId: "tool-1",
        version: 1,
        type: "MCP" as const,
        implementation: "MCP_V1" as const,
        mcp: {
          connectorVersionId: "cv-1",
          remoteToolName: "search_packages",
          inputSchema: {},
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
];

describe("connector agent handoff", () => {
  it("parses and deduplicates toolVersionIds hints", () => {
    expect(parseToolVersionHandoffParam("tv-1, tv-1 ,tv-2 tv-3")).toEqual([
      "tv-1",
      "tv-2",
      "tv-3",
    ]);
  });

  it("validates workspace catalog membership for hints", () => {
    const result = validateToolVersionHandoff(["tv-1", "foreign"], catalog);
    expect(result.validated.map((v) => v.toolVersionId)).toEqual(["tv-1"]);
    expect(result.rejected).toEqual(["foreign"]);
  });

  it("builds agent navigation without treating hints as authorization", () => {
    expect(buildAgentPickerHandoffPath(["tv-1"])).toBe(
      "/agents?toolVersionIds=tv-1",
    );
    expect(buildAgentVersionCreateHandoffPath("agent-9", ["tv-1"])).toBe(
      "/agents/agent-9/versions/new?toolVersionIds=tv-1",
    );
  });

  it("suggests stable binding names from remote MCP tool names", () => {
    expect(suggestBindingNameForRemoteTool("search/packages")).toBe(
      "search_packages",
    );
    expect(describeToolBindingNameError("9bad")).toMatch(
      /start with a letter/i,
    );
  });

  it("preselects binding rows without auto execution semantics", () => {
    const rows = buildPreselectedBindingRows(
      validateToolVersionHandoff(["tv-1"], catalog).validated,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toolVersionId).toBe("tv-1");
    expect(rows[0]?.bindingName).toBe("search_packages");
  });

  it("flags duplicate bindings and stale ToolVersions", () => {
    const issues = collectToolBindingValidationIssues(
      [
        { bindingName: "dup", toolId: "tool-1", toolVersionId: "tv-1" },
        { bindingName: "dup", toolId: "tool-1", toolVersionId: "tv-1" },
        { bindingName: "ok", toolId: "", toolVersionId: "missing" },
      ],
      catalog,
    );
    expect(issues.some((i) => i.kind === "duplicate_binding_name")).toBe(true);
    expect(issues.some((i) => i.kind === "stale_tool_version")).toBe(true);
  });

  it("maps stable tool error codes to actionable run-step guidance", () => {
    const auth = describeRunStepToolErrorGuidance(
      TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
    );
    expect(auth?.title).toMatch(/authorization denied/i);

    const missing = describeRunStepToolErrorGuidance(
      TOOL_ERROR_CODES.TOOL_VERSION_NOT_FOUND,
    );
    expect(missing?.nextSteps.join(" ")).toMatch(/workspace/i);
  });

  it("does not invent root cause from generic MCP failures", () => {
    const generic = describeRunStepToolErrorGuidance(
      TOOL_ERROR_CODES.MCP_TOOL_ERROR,
    );
    expect(generic?.explanation).toMatch(/sanitized error code/i);
    expect(generic?.explanation).not.toMatch(/rate limit/i);
  });

  it("links catalog connectors to verified example documentation paths", () => {
    const npmExamples = relatedExampleDocLinks("npm");
    expect(npmExamples[0]?.consolePath).toBe(
      "/examples/19-research-report-agent",
    );
    const githubExamples = relatedExampleDocLinks("github");
    expect(githubExamples[0]?.exampleId).toBe("20-github-repository-analyst");
  });
});
