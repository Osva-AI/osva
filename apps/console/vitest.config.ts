import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["test/integration/**"],
    setupFiles: ["test/setup.ts"],
    pool: "threads",
    maxWorkers: 4,
    fileParallelism: 4,
    testTimeout: 10_000,
  },
});
