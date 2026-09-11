import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    // Daemon integration tests spawn real git worktrees, SQLite databases and HTTP
    // servers. The 5s default is too tight once the suite runs in parallel, which turned
    // into rotating false-red timeouts instead of assertion failures.
    testTimeout: 30_000,
    exclude: ["**/node_modules/**", "**/dist/**", "tooling/docs/**/*.test.mjs"],
  },
});
