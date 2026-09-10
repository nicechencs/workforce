import { z } from "zod";

export const moneyKinds = ["unknown", "estimated", "settled"] as const;
export type MoneyKind = (typeof moneyKinds)[number];

export const moneySchema = z
  .object({
    costMinor: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    kind: z.enum(moneyKinds).optional(),
  })
  .strict();

export type Money = z.infer<typeof moneySchema>;

export function parseMoney(input: unknown): Money {
  return moneySchema.parse(input);
}

export function unknownCost(currency: string): Money {
  return { costMinor: 0, currency, kind: "unknown" };
}

export function isUnknownCost(money: Money): boolean {
  return money.kind === "unknown";
}
