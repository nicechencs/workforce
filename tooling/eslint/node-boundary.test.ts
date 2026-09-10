import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const forbiddenSource = `import fs from "node:fs";
export const probe = fs;
`;

async function lintAs(filePath: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintText(forbiddenSource, { filePath });
  return results[0]?.messages ?? [];
}

function reportsNodeBuiltinBoundary(
  messages: readonly { ruleId: string | null; message: string }[],
) {
  return messages.some(
    (message) => message.ruleId === "no-restricted-imports" && /node/i.test(message.message),
  );
}

describe("browser/Node import boundary", () => {
  it("rejects node:fs from packages/ui", async () => {
    const messages = await lintAs(
      path.join(repoRoot, "packages/ui/src/__node_boundary_probe__.ts"),
    );
    expect(reportsNodeBuiltinBoundary(messages)).toBe(true);
  });

  it("rejects node:fs from the desktop renderer", async () => {
    const messages = await lintAs(
      path.join(repoRoot, "apps/desktop/src/renderer/__node_boundary_probe__.ts"),
    );
    expect(reportsNodeBuiltinBoundary(messages)).toBe(true);
  });
});
