export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface ScheduledTask {
  cancel(): void;
}

export interface Scheduler {
  schedule(delayMs: number, work: () => void): ScheduledTask;
}

export class TimeoutScheduler implements Scheduler {
  schedule(delayMs: number, work: () => void): ScheduledTask {
    const timer = setTimeout(work, delayMs);
    return { cancel: () => clearTimeout(timer) };
  }
}

export class ManualScheduler implements Clock, Scheduler {
  private currentMs: number;
  private readonly tasks: Array<{ at: number; work: () => void; cancelled: boolean }> = [];

  constructor(iso = "2026-09-10T10:00:00.000Z") {
    this.currentMs = Date.parse(iso);
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  schedule(delayMs: number, work: () => void): ScheduledTask {
    const item = { at: this.currentMs + delayMs, work, cancelled: false };
    this.tasks.push(item);
    return {
      cancel: () => {
        item.cancelled = true;
      },
    };
  }

  async advance(ms: number): Promise<void> {
    this.currentMs += ms;
    await this.flush();
  }

  async flush(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const due = this.tasks.filter((task) => !task.cancelled && task.at <= this.currentMs);
      if (due.length === 0) {
        break;
      }
      for (const task of due) {
        task.cancelled = true;
        task.work();
        progressed = true;
      }
      await Promise.resolve();
    }
  }
}
