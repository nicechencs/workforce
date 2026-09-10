export class InvalidTransitionError extends Error {
  readonly code = "invalid_transition" as const;

  constructor(
    readonly entity: string,
    readonly from: string,
    readonly command: string,
  ) {
    super(`${entity} cannot '${command}' from '${from}'`);
    this.name = "InvalidTransitionError";
  }
}
