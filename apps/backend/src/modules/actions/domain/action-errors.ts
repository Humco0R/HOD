export class ActionTransitionError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'INVALID_TRANSITION' | 'REASON_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ActionTransitionError';
  }
}
