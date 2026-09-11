import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { remapJsSpecifierToTs } from "./ts-esm-resolve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registerUrl = pathToFileURL(path.join(root, "tooling/scripts/register-ts-esm.mjs")).href;

describe("ts ESM resolve hook", () => {
  it("rewrites relative .js specifiers to .ts", () => {
    expect(remapJsSpecifierToTs("./command.js")).toBe("./command.ts");
    expect(remapJsSpecifierToTs("../errors.js")).toBe("../errors.ts");
    expect(remapJsSpecifierToTs("@workforce/protocol")).toBeNull();
    expect(remapJsSpecifierToTs("./command.ts")).toBeNull();
  });

  it("loads protocol source that imports .js siblings", () => {
    const protocolIndex = pathToFileURL(path.join(root, "packages/protocol/src/index.ts")).href;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        registerUrl,
        "--input-type=module",
        "-e",
        `import { protocolVersion } from ${JSON.stringify(protocolIndex)}; console.log(protocolVersion)`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("0.1");
  });
});
