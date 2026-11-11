import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    // Spawns Docker-backed Postgres + Valkey and multi-process web/worker/MCP stacks;
    // align with @osva/console integration budgets under verify:ci INTEGRATION load.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
