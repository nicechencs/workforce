import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "unit",
      environment: "node",
      include: [
        "packages/**/*.test.ts",
        "apps/**/*.test.ts",
        "apps/**/*.test.tsx",
        "runtimes/**/*.test.ts",
        "tooling/**/*.test.ts",
        "tests/integration/**/*.test.ts",
        "tests/e2e/**/*.test.ts",
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "tooling/docs/**/*.test.mjs"],
    },
  },
]);
