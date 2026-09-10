export const EVENT_CONTRACTS = {
  envelope: "workforce.event.0.1",
  streamSequence: "per-stream",
  ingestionPosition: "sqlite-monotonic",
} as const;

export type EventContractName = (typeof EVENT_CONTRACTS)[keyof typeof EVENT_CONTRACTS];
