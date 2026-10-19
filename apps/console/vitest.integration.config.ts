import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // One integration file at a time: each file owns disposable Docker infra.
    fileParallelism: false,
  },
});
