import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "tests",
    environment: "node",
    include: [
      "integration/**/*.test.ts",
      "e2e/**/*.test.ts",
      "contract/**/*.test.ts",
      "platform/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
