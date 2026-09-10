import { randomBytes } from "node:crypto";

import { ID_PREFIX } from "@workforce/domain";

export type IdFactory = (prefix: string) => string;

export function createIdFactory(): IdFactory {
  return (prefix: string) => `${prefix}${randomBytes(10).toString("hex")}`;
}

export const prefixes = ID_PREFIX;
