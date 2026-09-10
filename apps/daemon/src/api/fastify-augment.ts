import type { Session } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
    bootstrapToken?: string;
  }
}

export {};
