export interface EventSubscribeInput {
  cursor?: string;
  types?: string[];
}

export interface LiveSubscription {
  subscriptionId: string;
  key: string;
  cursor: string;
  types: string[];
}

export function subscriptionKey(input: EventSubscribeInput): string {
  const types = input.types ? [...input.types].sort().join(",") : "*";
  return `${types}#${input.cursor ?? ""}`;
}

export class EventSubscriptionHub {
  readonly #byKey = new Map<string, LiveSubscription>();
  readonly #byId = new Map<string, LiveSubscription>();

  subscribe(input: EventSubscribeInput): { subscription: LiveSubscription; created: boolean } {
    const key = subscriptionKey(input);
    const existing = this.#byKey.get(key);
    if (existing) {
      return { subscription: existing, created: false };
    }
    const subscription: LiveSubscription = {
      subscriptionId: `sub_${this.#byId.size + 1}`,
      key,
      cursor: input.cursor ?? "",
      types: input.types ? [...input.types] : [],
    };
    this.#byKey.set(key, subscription);
    this.#byId.set(subscription.subscriptionId, subscription);
    return { subscription, created: true };
  }

  unsubscribe(subscriptionId: string): boolean {
    const existing = this.#byId.get(subscriptionId);
    if (!existing) {
      return false;
    }
    this.#byId.delete(subscriptionId);
    this.#byKey.delete(existing.key);
    return true;
  }

  get size(): number {
    return this.#byId.size;
  }

  clear(): void {
    this.#byKey.clear();
    this.#byId.clear();
  }
}
