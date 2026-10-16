import { defineConfig } from "vitest/config";

const subprocessIncludes = [
  "test/bin.test.ts",
  "test/init.test.ts",
  "test/deploy.test.ts",
  "test/validate.test.ts",
  "test/helpers/run-cli-subprocess.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: subprocessIncludes,
        },
      },
      {
        test: {
          name: "subprocess",
          environment: "node",
          include: subprocessIncludes,
          setupFiles: ["test/helpers/subprocess-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
