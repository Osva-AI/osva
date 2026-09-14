import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
    ],
  },
  tseslint.configs.recommended,
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@osva/*"],
              message:
                "packages/contracts cannot depend on other OSVA packages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message: "packages/domain cannot import persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "packages/domain cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "packages/domain cannot import runtime-core.",
            },
            {
              name: "@osva/web",
              message: "packages/domain cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "packages/domain cannot import apps.",
            },
            {
              name: "@osva/contracts/schemas",
              message: "packages/domain cannot import runtime Zod schemas.",
            },
            {
              name: "zod",
              message: "packages/domain cannot depend on Zod.",
            },
            {
              name: "drizzle-orm",
              message: "packages/domain cannot import persistence libraries.",
            },
            {
              name: "postgres",
              message: "packages/domain cannot import PostgreSQL drivers.",
            },
            {
              name: "bullmq",
              message: "packages/domain cannot import queue libraries.",
            },
            {
              name: "ioredis",
              message: "packages/domain cannot import Redis clients.",
            },
            {
              name: "redis",
              message: "packages/domain cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "packages/domain cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message: "packages/domain cannot import adapters.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "packages/domain cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message: "packages/domain cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
);
