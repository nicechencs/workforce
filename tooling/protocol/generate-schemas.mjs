import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

// This generator runs under plain Node and deliberately reads compiled registry modules:
// the package export map points at TypeScript sources, which Node cannot load without a loader.
// Importing dist/index.js would also pull @workforce/domain TypeScript sources.
// eslint-disable-next-line no-restricted-imports -- build-time tooling, not application code
import {
  PROTOCOL_JSON_SCHEMA_DIALECT,
  PROTOCOL_OPENAPI_FILE_NAME,
  assertProtocolRegistryInvariants,
  assertPublicDtoSchemasRegistered,
  protocolJsonSchemaRegistry,
} from "../../packages/protocol/dist/json-schema-registry.js";
// eslint-disable-next-line no-restricted-imports -- build-time tooling, not application code
import { buildProtocolOpenApiDocument } from "../../packages/protocol/dist/openapi.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = path.join(root, "docs", "protocols", "v0.1");
const checking = process.argv.includes("--check");
const openApiFileName = PROTOCOL_OPENAPI_FILE_NAME;
const openApiPath = path.join(outputDirectory, openApiFileName);
const registry = protocolJsonSchemaRegistry;
const expectedFiles = new Set(registry.map((entry) => entry.fileName));

await assertPublicationSurface();

const generated = registry.map((entry) => ({
  fileName: entry.fileName,
  content: renderJsonSchema(entry),
}));
const openApiDocument = buildOpenApiDocument(registry);
const openApiContent = `${JSON.stringify(stableObject(openApiDocument), null, 2)}\n`;
const actualFiles = fs
  .readdirSync(outputDirectory)
  .filter((fileName) => fileName.endsWith(".schema.json"));
const unexpectedFiles = actualFiles.filter((fileName) => !expectedFiles.has(fileName));

if (checking) {
  const schemaDrift = generated.filter(({ fileName, content }) => {
    const outputPath = path.join(outputDirectory, fileName);
    return !fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== content;
  });
  const previousOpenApi = readJsonIfPresent(openApiPath);
  const openApiDrift =
    !fs.existsSync(openApiPath) || fs.readFileSync(openApiPath, "utf8") !== openApiContent;
  const breaking = previousOpenApi
    ? classifyOpenApiBreakingChanges(previousOpenApi, openApiDocument)
    : [];
  if (schemaDrift.length > 0 || unexpectedFiles.length > 0 || openApiDrift) {
    const files = [
      ...schemaDrift.map(({ fileName }) => fileName),
      ...unexpectedFiles,
      ...(openApiDrift ? [openApiFileName] : []),
    ].sort();
    console.error(`Protocol JSON Schema / OpenAPI drift: ${files.join(", ")}`);
    if (breaking.length > 0) {
      console.error(`Breaking OpenAPI changes:\n${breaking.map((item) => `- ${item}`).join("\n")}`);
    }
    console.error("Run: pnpm protocol:schema:generate");
    process.exitCode = 1;
  } else {
    console.log(
      `Protocol JSON Schema and OpenAPI 3.1 check passed (${generated.length} schemas, 1 OpenAPI document).`,
    );
  }
} else {
  for (const { fileName, content } of generated) {
    fs.writeFileSync(path.join(outputDirectory, fileName), content, "utf8");
  }
  const previousOpenApi = readJsonIfPresent(openApiPath);
  const breaking = previousOpenApi
    ? classifyOpenApiBreakingChanges(previousOpenApi, openApiDocument)
    : [];
  fs.writeFileSync(openApiPath, openApiContent, "utf8");
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Unexpected generated schema files remain: ${unexpectedFiles.sort().join(", ")}. Remove them explicitly after changing the registry.`,
    );
  }
  if (breaking.length > 0) {
    console.warn(`Breaking OpenAPI changes:\n${breaking.map((item) => `- ${item}`).join("\n")}`);
  }
  console.log(`Generated ${generated.length} protocol JSON Schema files and ${openApiFileName}.`);
}

async function assertPublicationSurface() {
  assertProtocolRegistryInvariants(registry);
  const exportedDtoSchemas = await loadExportedDtoSchemas();
  assertPublicDtoSchemasRegistered(exportedDtoSchemas, registry);
}

async function loadExportedDtoSchemas() {
  const srcDir = path.join(root, "packages", "protocol", "src");
  const schemas = {};
  for (const fileName of fs.readdirSync(srcDir)) {
    if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts")) continue;
    const source = fs.readFileSync(path.join(srcDir, fileName), "utf8");
    const names = [...source.matchAll(/export const (\w+DtoSchema)\b/g)].map((match) => match[1]);
    if (names.length === 0) continue;
    const distPath = path.join(
      root,
      "packages",
      "protocol",
      "dist",
      fileName.replace(/\.ts$/, ".js"),
    );
    const module = await import(pathToFileURL(distPath).href);
    for (const name of names) {
      if (module[name] === undefined) {
        throw new Error(`Expected export ${name} in ${distPath}`);
      }
      schemas[name] = module[name];
    }
  }
  return schemas;
}

function jsonSchemaFor(entry) {
  const converted = zodToJsonSchema(entry.schema, {
    $refStrategy: "none",
    target: "jsonSchema2019-09",
  });
  delete converted.$schema;
  return converted;
}

function renderJsonSchema(entry) {
  return `${JSON.stringify(
    stableObject({
      $schema: PROTOCOL_JSON_SCHEMA_DIALECT,
      $id: `https://workforce.local/protocols/v0.1/${entry.fileName}`,
      title: entry.title,
      ...jsonSchemaFor(entry),
    }),
    null,
    2,
  )}\n`;
}

function buildOpenApiDocument(entries) {
  const schemas = Object.fromEntries(
    entries.map((entry) => {
      const converted = jsonSchemaFor(entry);
      return [entry.title, stableObject({ title: entry.title, ...converted })];
    }),
  );
  return buildProtocolOpenApiDocument(schemas);
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function classifyOpenApiBreakingChanges(previous, next) {
  const previousSchemas = previous?.components?.schemas ?? {};
  const nextSchemas = next?.components?.schemas ?? {};
  const breaking = [];
  for (const name of Object.keys(previousSchemas)) {
    if (!(name in nextSchemas)) {
      breaking.push(`removed schema ${name}`);
      continue;
    }
    diffSchema(name, previousSchemas[name], nextSchemas[name], breaking);
  }
  return breaking;
}

function diffSchema(path, previous, next, breaking) {
  if (!isObject(previous) || !isObject(next)) {
    if (previous !== next) breaking.push(`${path} changed`);
    return;
  }
  if (previous.type !== undefined && next.type !== undefined && previous.type !== next.type) {
    breaking.push(`${path} type ${JSON.stringify(previous.type)} -> ${JSON.stringify(next.type)}`);
  }
  if (previous.const !== undefined && next.const !== undefined && previous.const !== next.const) {
    breaking.push(
      `${path} const ${JSON.stringify(previous.const)} -> ${JSON.stringify(next.const)}`,
    );
  }
  const previousRequired = new Set(Array.isArray(previous.required) ? previous.required : []);
  const nextRequired = new Set(Array.isArray(next.required) ? next.required : []);
  for (const field of nextRequired) {
    if (!previousRequired.has(field)) {
      breaking.push(`${path} property ${field} became required`);
    }
  }
  const previousProperties = isObject(previous.properties) ? previous.properties : {};
  const nextProperties = isObject(next.properties) ? next.properties : {};
  for (const key of Object.keys(previousProperties)) {
    const childPath = `${path}.${key}`;
    if (!(key in nextProperties)) {
      breaking.push(`${path} removed property ${key}`);
    } else {
      diffSchema(childPath, previousProperties[key], nextProperties[key], breaking);
    }
  }
  if (Array.isArray(previous.enum)) {
    const nextEnum = Array.isArray(next.enum) ? next.enum : [];
    for (const value of previous.enum) {
      if (!nextEnum.includes(value)) {
        breaking.push(`${path} removed enum value ${JSON.stringify(value)}`);
      }
    }
  }
  if (previous.items !== undefined && next.items !== undefined) {
    diffSchema(`${path}[]`, previous.items, next.items, breaking);
  }
  for (const combinator of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(previous[combinator]) && Array.isArray(next[combinator])) {
      const previousCount = previous[combinator].length;
      const nextCount = next[combinator].length;
      if (nextCount < previousCount) {
        breaking.push(`${path} ${combinator} shrank ${previousCount} -> ${nextCount}`);
      }
    } else if (Array.isArray(previous[combinator]) && !Array.isArray(next[combinator])) {
      breaking.push(`${path} removed ${combinator}`);
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
