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
      ],
      exclude: ["**/node_modules/**", "**/dist/**"],
    },
  },
  {
    extends: "./vitest.config.ts",
    root: "./tests",
    test: {
      name: "integration",
      environment: "node",
      include: [
        "integration/**/*.test.ts",
        "e2e/**/*.test.ts",
        "contract/**/*.test.ts",
        "platform/**/*.test.ts",
      ],
      exclude: ["**/node_modules/**", "**/dist/**"],
    },
  },
]);
