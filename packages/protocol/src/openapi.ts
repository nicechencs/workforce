import { PROTOCOL_JSON_SCHEMA_DIALECT, PROTOCOL_OPENAPI_VERSION } from "./json-schema-registry.js";
import { protocolVersion } from "./protocol-version.js";

/**
 * OpenAPI 3.1 document generated from the Zod publication registry.
 * HTTP paths stay with the Daemon; this document publishes components only.
 */
export interface ProtocolOpenApiDocument {
  openapi: typeof PROTOCOL_OPENAPI_VERSION;
  info: {
    title: string;
    version: string;
    description: string;
  };
  jsonSchemaDialect: typeof PROTOCOL_JSON_SCHEMA_DIALECT;
  paths: Record<string, never>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
  };
}

export function buildProtocolOpenApiDocument(
  schemas: Record<string, Record<string, unknown>>,
): ProtocolOpenApiDocument {
  return {
    openapi: PROTOCOL_OPENAPI_VERSION,
    info: {
      title: "Workforce V0.1 Protocol",
      version: protocolVersion,
      description:
        "Public V0.1 wire contracts generated from the Zod registry in @workforce/protocol. HTTP paths are implemented by the Daemon; this document publishes components.schemas only. A new public DTO must be added to protocolJsonSchemaRegistry before it is a published contract.",
    },
    jsonSchemaDialect: PROTOCOL_JSON_SCHEMA_DIALECT,
    paths: {},
    components: { schemas },
  };
}
