import { describe, expect, it } from "vitest";

import { createKnowledgeWorkerProcess } from "../src/process.js";

const BASE_ENV = {
  OSVA_DATABASE_URL: "postgres://osva:osva@127.0.0.1:1/osva",
  OSVA_VALKEY_URL: "redis://127.0.0.1:1",
  OSVA_ARTIFACT_STORAGE_DRIVER: "filesystem",
  OSVA_ARTIFACT_FILESYSTEM_ROOT: ".osva/artifacts",
};

describe("createKnowledgeWorkerProcess", () => {
  it("fails startup when required dependencies are unavailable", async () => {
    const worker = createKnowledgeWorkerProcess(BASE_ENV);
    await expect(worker.start()).rejects.toThrow();
  });
});
