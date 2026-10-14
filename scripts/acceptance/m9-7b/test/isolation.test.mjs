import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findUnauthorizedContainerRemovals } from "../lib/docker.js";

describe("acceptance docker isolation helpers", () => {
  it("flags removals of containers not owned by the current run", () => {
    const runId = "d5085479-0d60-4d9b-9665-077c0db5ea37";
    const before = {
      containers: [
        { id: "1", name: "osva-m97b-d50854790d60-pg", status: "Up" },
        { id: "2", name: "operator-postgres", status: "Up" },
      ],
    };
    const after = {
      containers: [
        { id: "1", name: "osva-m97b-d50854790d60-pg", status: "Up" },
      ],
    };
    const removed = findUnauthorizedContainerRemovals(before, after, runId);
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.name, "operator-postgres");
  });

  it("allows removal of containers owned by the current run id", () => {
    const runId = "d5085479-0d60-4d9b-9665-077c0db5ea37";
    const before = {
      containers: [
        { id: "1", name: "osva-m97b-d50854790d60-pg", status: "Up" },
        { id: "2", name: "osva-m97b-d50854790d60-valkey", status: "Up" },
      ],
    };
    const after = { containers: [] };
    const removed = findUnauthorizedContainerRemovals(before, after, runId);
    assert.equal(removed.length, 0);
  });
});
