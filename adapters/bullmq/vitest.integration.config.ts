import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    // One Valkey container per file; avoid parallel Docker starts (CI TEST/HARNESS contention).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
