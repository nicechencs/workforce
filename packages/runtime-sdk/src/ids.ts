export interface IdGenerator {
  ulid(prefix: string): string;
}

export class SequentialIdGenerator implements IdGenerator {
  private seq = 0;

  constructor(seed = 0) {
    this.seq = seed;
  }

  ulid(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq.toString(16).padStart(26, "0")}`;
  }
}
