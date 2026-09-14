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
              name: "@osva/adapters-memory",
              message: "packages/domain cannot import adapters.",
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
          ],
        },
      ],
    },
  },
);
