import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/mcp-connector-tool-gateway.integration.test.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
    pool: "forks",
  },
});
