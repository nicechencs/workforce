import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

// This generator runs under plain Node and deliberately reads the compiled registry: the
// package export map points at TypeScript sources, which Node cannot load without a loader.
// eslint-disable-next-line no-restricted-imports -- build-time tooling, not application code
import { protocolJsonSchemaRegistry } from "../../packages/protocol/dist/json-schema-registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = path.join(root, "docs", "protocols", "v0.1");
const checking = process.argv.includes("--check");
const expectedFiles = new Set(protocolJsonSchemaRegistry.map((entry) => entry.fileName));

const generated = protocolJsonSchemaRegistry.map((entry) => ({
  fileName: entry.fileName,
  content: render(entry),
}));
const actualFiles = fs
  .readdirSync(outputDirectory)
  .filter((fileName) => fileName.endsWith(".schema.json"));
const unexpectedFiles = actualFiles.filter((fileName) => !expectedFiles.has(fileName));

if (checking) {
  const drift = generated.filter(({ fileName, content }) => {
    const outputPath = path.join(outputDirectory, fileName);
    return !fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== content;
  });
  if (drift.length > 0 || unexpectedFiles.length > 0) {
    const files = [...drift.map(({ fileName }) => fileName), ...unexpectedFiles].sort();
    console.error(`Protocol JSON Schema drift: ${files.join(", ")}`);
    console.error("Run: pnpm protocol:schema:generate");
    process.exitCode = 1;
  } else {
    console.log(`Protocol JSON Schema check passed (${generated.length} files).`);
  }
} else {
  for (const { fileName, content } of generated) {
    fs.writeFileSync(path.join(outputDirectory, fileName), content, "utf8");
  }
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Unexpected generated schema files remain: ${unexpectedFiles.sort().join(", ")}. Remove them explicitly after changing the registry.`,
    );
  }
  console.log(`Generated ${generated.length} protocol JSON Schema files.`);
}

function render(entry) {
  const converted = zodToJsonSchema(entry.schema, {
    $refStrategy: "none",
    target: "jsonSchema2019-09",
  });
  delete converted.$schema;
  return `${JSON.stringify(
    stableObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://workforce.local/protocols/v0.1/${entry.fileName}`,
      title: entry.title,
      ...converted,
    }),
    null,
    2,
  )}\n`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableObject(child)]),
    );
  }
  return value;
}
