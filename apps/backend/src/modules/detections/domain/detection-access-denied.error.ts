export class DetectionAccessDeniedError extends Error {
  constructor() {
    super('Only the source author can manage this proposal');
  }
}
