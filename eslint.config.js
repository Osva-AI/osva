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
              name: "@osva/scheduler",
              message: "packages/domain cannot import apps.",
            },
            {
              name: "@osva/workflow-orchestrator",
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
  {
    files: ["packages/model-gateway/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message: "packages/model-gateway cannot import persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "packages/model-gateway cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "packages/model-gateway cannot import runtime-core.",
            },
            {
              name: "@osva/web",
              message: "packages/model-gateway cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "packages/model-gateway cannot import apps.",
            },
            {
              name: "openai",
              message:
                "packages/model-gateway cannot import provider SDKs; adapters own those types.",
            },
            {
              name: "bullmq",
              message: "packages/model-gateway cannot import queue libraries.",
            },
            {
              name: "ioredis",
              message: "packages/model-gateway cannot import Redis clients.",
            },
            {
              name: "postgres",
              message:
                "packages/model-gateway cannot import PostgreSQL drivers.",
            },
            {
              name: "drizzle-orm",
              message:
                "packages/model-gateway cannot import persistence libraries.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message:
                "packages/model-gateway cannot import adapters; the composition root wires providers.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "packages/model-gateway cannot import provider SDKs.",
            },
            {
              group: ["openai/*"],
              message: "packages/model-gateway cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "packages/model-gateway cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/model-openai/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message:
                "adapters/model-openai stays below ModelGateway and cannot import domain persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "adapters/model-openai cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "adapters/model-openai cannot import runtime-core.",
            },
            {
              name: "@osva/db",
              message: "adapters/model-openai cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "adapters/model-openai cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "adapters/model-openai cannot import apps.",
            },
            {
              name: "@osva/adapters-memory",
              message:
                "adapters/model-openai production code cannot import test adapters.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message:
                "adapters/model-openai implements only the OpenAI provider.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "adapters/model-openai cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/model-anthropic/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message:
                "adapters/model-anthropic stays below ModelGateway and cannot import domain persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "adapters/model-anthropic cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "adapters/model-anthropic cannot import runtime-core.",
            },
            {
              name: "@osva/db",
              message: "adapters/model-anthropic cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "adapters/model-anthropic cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "adapters/model-anthropic cannot import apps.",
            },
            {
              name: "@osva/adapters-memory",
              message:
                "adapters/model-anthropic production code cannot import test adapters.",
            },
            {
              name: "openai",
              message:
                "adapters/model-anthropic implements only the Anthropic provider.",
            },
          ],
          patterns: [
            {
              group: ["openai/*"],
              message:
                "adapters/model-anthropic implements only the Anthropic provider.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "adapters/model-anthropic cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/model-gemini/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message:
                "adapters/model-gemini stays below ModelGateway and cannot import domain persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "adapters/model-gemini cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "adapters/model-gemini cannot import runtime-core.",
            },
            {
              name: "@osva/db",
              message: "adapters/model-gemini cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "adapters/model-gemini cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "adapters/model-gemini cannot import apps.",
            },
            {
              name: "@osva/adapters-memory",
              message:
                "adapters/model-gemini production code cannot import test adapters.",
            },
            {
              name: "openai",
              message:
                "adapters/model-gemini implements only the Google Gemini provider.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message:
                "adapters/model-gemini implements only the Google Gemini provider.",
            },
            {
              group: ["openai/*"],
              message:
                "adapters/model-gemini implements only the Google Gemini provider.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "adapters/model-gemini cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/bullmq/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message:
                "adapters/bullmq cannot import domain types; JobQueue stays in contracts.",
            },
            {
              name: "@osva/orchestration",
              message: "adapters/bullmq cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "adapters/bullmq cannot import runtime-core.",
            },
            {
              name: "@osva/db",
              message: "adapters/bullmq cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "adapters/bullmq cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "adapters/bullmq cannot import apps.",
            },
            {
              name: "@osva/adapters-memory",
              message:
                "adapters/bullmq production code cannot import test adapters.",
            },
            {
              name: "openai",
              message: "adapters/bullmq cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message: "adapters/bullmq cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/runtime-typescript/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message:
                "The trusted TypeScript runtime depends on contracts, not domain persistence.",
            },
            {
              name: "@osva/orchestration",
              message:
                "The trusted TypeScript runtime cannot import orchestration.",
            },
            {
              name: "@osva/db",
              message:
                "The trusted TypeScript runtime cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "The trusted TypeScript runtime cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "The trusted TypeScript runtime cannot import apps.",
            },
            {
              name: "bullmq",
              message: "The trusted TypeScript runtime cannot import BullMQ.",
            },
            {
              name: "ioredis",
              message:
                "The trusted TypeScript runtime cannot import Redis clients.",
            },
            {
              name: "postgres",
              message:
                "The trusted TypeScript runtime cannot import PostgreSQL drivers.",
            },
            {
              name: "drizzle-orm",
              message:
                "The trusted TypeScript runtime cannot import persistence libraries.",
            },
            {
              name: "openai",
              message:
                "The trusted TypeScript runtime cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message:
                "The trusted TypeScript runtime cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "The trusted TypeScript runtime cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/memory/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message:
                "adapters/memory cannot import persistence infrastructure.",
            },
            {
              name: "@osva/orchestration",
              message: "adapters/memory cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "adapters/memory cannot import runtime-core.",
            },
            {
              name: "@osva/web",
              message: "adapters/memory cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "adapters/memory cannot import apps.",
            },
            {
              name: "zod",
              message: "adapters/memory cannot depend on Zod.",
            },
            {
              name: "drizzle-orm",
              message: "adapters/memory cannot import persistence libraries.",
            },
            {
              name: "postgres",
              message: "adapters/memory cannot import PostgreSQL drivers.",
            },
            {
              name: "bullmq",
              message:
                "adapters/memory cannot import distributed queue libraries.",
            },
            {
              name: "ioredis",
              message: "adapters/memory cannot import Redis clients.",
            },
            {
              name: "redis",
              message: "adapters/memory cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "adapters/memory cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message: "adapters/memory cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message: "adapters/memory cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/db/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/orchestration",
              message: "packages/db cannot import orchestration.",
            },
            {
              name: "@osva/runtime-core",
              message: "packages/db cannot import runtime-core.",
            },
            {
              name: "@osva/web",
              message: "packages/db cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "packages/db cannot import apps.",
            },
            {
              name: "bullmq",
              message: "packages/db cannot import queue libraries.",
            },
            {
              name: "ioredis",
              message: "packages/db cannot import Redis clients.",
            },
            {
              name: "redis",
              message: "packages/db cannot import Redis clients.",
            },
            {
              name: "pg",
              message: "packages/db uses postgres.js, not pg.",
            },
            {
              name: "prisma",
              message: "packages/db cannot import Prisma.",
            },
            {
              name: "@prisma/client",
              message: "packages/db cannot import Prisma.",
            },
            {
              name: "typeorm",
              message: "packages/db cannot import TypeORM.",
            },
            {
              name: "testcontainers",
              message: "packages/db cannot import Testcontainers.",
            },
            {
              name: "openai",
              message: "packages/db cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message: "packages/db cannot import adapters.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "packages/db cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/orchestration/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message:
                "packages/orchestration cannot import persistence adapters.",
            },
            {
              name: "@osva/web",
              message: "packages/orchestration cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "packages/orchestration cannot import apps.",
            },
            {
              name: "drizzle-orm",
              message:
                "packages/orchestration cannot import persistence libraries.",
            },
            {
              name: "postgres",
              message:
                "packages/orchestration cannot import PostgreSQL drivers.",
            },
            {
              name: "bullmq",
              message: "packages/orchestration cannot import queue libraries.",
            },
            {
              name: "ioredis",
              message: "packages/orchestration cannot import Redis clients.",
            },
            {
              name: "redis",
              message: "packages/orchestration cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "packages/orchestration cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message: "packages/orchestration cannot import adapters.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "packages/orchestration cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "packages/orchestration cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/runtime-core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message: "packages/runtime-core cannot import persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "packages/runtime-core cannot import orchestration.",
            },
            {
              name: "@osva/web",
              message: "packages/runtime-core cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "packages/runtime-core cannot import apps.",
            },
            {
              name: "drizzle-orm",
              message:
                "packages/runtime-core cannot import persistence libraries.",
            },
            {
              name: "postgres",
              message:
                "packages/runtime-core cannot import PostgreSQL drivers.",
            },
            {
              name: "bullmq",
              message: "packages/runtime-core cannot import queue libraries.",
            },
            {
              name: "ioredis",
              message: "packages/runtime-core cannot import Redis clients.",
            },
            {
              name: "redis",
              message: "packages/runtime-core cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "packages/runtime-core cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message: "packages/runtime-core cannot import adapters.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "packages/runtime-core cannot import provider SDKs.",
            },
            {
              group: ["drizzle-orm/*"],
              message:
                "packages/runtime-core cannot import persistence libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/web/src/**/*.ts",
      "apps/scheduler/src/**/*.ts",
      "apps/workflow-orchestrator/src/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/runtime-core",
              message:
                "Control-plane process shells do not execute Agent runtimes.",
            },
            {
              name: "bullmq",
              message:
                "Process shells must use @osva/adapters-bullmq, not BullMQ directly.",
            },
            {
              name: "ioredis",
              message: "Process shells cannot import Redis/Valkey clients.",
            },
            {
              name: "redis",
              message: "Process shells cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "Process shells cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-memory", "@osva/adapters-memory/*"],
              message:
                "Do not wire MemoryJobQueue or FakeRuntimeAdapter into production process shells.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "Process shells cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/worker",
              message: "apps/web cannot import the worker process.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/worker/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/web",
              message: "apps/worker cannot import the web process.",
            },
            {
              name: "bullmq",
              message:
                "Process shells must use @osva/adapters-bullmq, not BullMQ directly.",
            },
            {
              name: "ioredis",
              message: "Process shells cannot import Redis/Valkey clients.",
            },
            {
              name: "redis",
              message: "Process shells cannot import Redis clients.",
            },
            {
              name: "openai",
              message: "Process shells cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-memory", "@osva/adapters-memory/*"],
              message:
                "Do not wire MemoryJobQueue or FakeRuntimeAdapter into production process shells.",
            },
            {
              group: ["@anthropic-ai/*"],
              message: "Process shells cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/runtime-protocol/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message: "runtime-protocol cannot import persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "runtime-protocol cannot import orchestration.",
            },
            {
              name: "@osva/web",
              message: "runtime-protocol cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "runtime-protocol cannot import apps.",
            },
            {
              name: "bullmq",
              message: "runtime-protocol cannot import queue libraries.",
            },
            {
              name: "openai",
              message: "runtime-protocol cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@osva/adapters-*"],
              message: "runtime-protocol cannot import adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/runtime-http/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/db",
              message: "The remote HTTP runtime cannot import persistence.",
            },
            {
              name: "@osva/orchestration",
              message: "The remote HTTP runtime cannot import orchestration.",
            },
            {
              name: "@osva/web",
              message: "The remote HTTP runtime cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "The remote HTTP runtime cannot import apps.",
            },
            {
              name: "bullmq",
              message: "The remote HTTP runtime cannot import BullMQ.",
            },
            {
              name: "openai",
              message: "The remote HTTP runtime cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message: "The remote HTTP runtime cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/runtime-container/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osva/domain",
              message: "The container runtime cannot import domain.",
            },
            {
              name: "@osva/orchestration",
              message: "The container runtime cannot import orchestration.",
            },
            {
              name: "@osva/model-gateway",
              message: "The container runtime cannot import gateways.",
            },
            {
              name: "@osva/tool-gateway",
              message: "The container runtime cannot import gateways.",
            },
            {
              name: "@osva/memory-gateway",
              message: "The container runtime cannot import gateways.",
            },
            {
              name: "@osva/db",
              message: "The container runtime cannot import persistence.",
            },
            {
              name: "@osva/web",
              message: "The container runtime cannot import apps.",
            },
            {
              name: "@osva/worker",
              message: "The container runtime cannot import apps.",
            },
            {
              name: "bullmq",
              message: "The container runtime cannot import BullMQ.",
            },
            {
              name: "openai",
              message: "The container runtime cannot import provider SDKs.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message: "The container runtime cannot import provider SDKs.",
            },
          ],
        },
      ],
    },
  },
);
