import {
  APPROVAL_REQUEST_STATES,
  MODEL_PROVIDERS,
  RUN_ATTEMPT_STATES,
  RUN_STATES,
  WORKFLOW_NODE_RUN_STATES,
  WORKFLOW_RUN_STATES,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  PERSISTED_APPROVAL_REQUEST_STATES,
  PERSISTED_MODEL_PROVIDERS,
  PERSISTED_RUN_ATTEMPT_STATES,
  PERSISTED_RUN_STATES,
  PERSISTED_WORKFLOW_NODE_RUN_STATES,
  PERSISTED_WORKFLOW_RUN_STATES,
} from "../src/schema/states.js";

describe("persisted Stage 0 state columns", () => {
  it("keeps run status CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_RUN_STATES]).toEqual([...RUN_STATES]);
  });

  it("keeps run attempt status CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_RUN_ATTEMPT_STATES]).toEqual([...RUN_ATTEMPT_STATES]);
  });

  it("keeps model provider CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_MODEL_PROVIDERS]).toEqual([...MODEL_PROVIDERS]);
  });

  it("keeps workflow and approval status CHECK values identical to @osva/contracts", () => {
    expect([...PERSISTED_WORKFLOW_RUN_STATES]).toEqual([
      ...WORKFLOW_RUN_STATES,
    ]);
    expect([...PERSISTED_WORKFLOW_NODE_RUN_STATES]).toEqual([
      ...WORKFLOW_NODE_RUN_STATES,
    ]);
    expect([...PERSISTED_APPROVAL_REQUEST_STATES]).toEqual([
      ...APPROVAL_REQUEST_STATES,
    ]);
  });
});
