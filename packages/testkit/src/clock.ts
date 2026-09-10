import type { Clock } from "@workforce/application";

export class FakeClock implements Clock {
  private current: Date;

  constructor(iso = "2026-09-10T10:00:00.000Z") {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
