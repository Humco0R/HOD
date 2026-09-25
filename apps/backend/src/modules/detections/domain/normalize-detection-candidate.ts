import type { DetectionCandidate } from './detection';

export class InvalidDetectionCandidateError extends Error {}

export function normalizeDetectionCandidate(candidate: DetectionCandidate): DetectionCandidate {
  if (
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new InvalidDetectionCandidateError('Detection confidence must be between 0 and 1');
  }
  const normalized: DetectionCandidate = {
    ...candidate,
    title: clean(candidate.title, 500),
    assigneeReference: clean(candidate.assigneeReference, 300),
    deadlineAt: clean(candidate.deadlineAt, 100),
    deadlineDate: clean(candidate.deadlineDate, 10),
    deadlineDependency: clean(candidate.deadlineDependency, 500),
    deadlineRaw: clean(candidate.deadlineRaw, 500),
    expectedResultText: clean(candidate.expectedResultText, 1_000),
    location: clean(candidate.location, 500),
  };
  if (normalized.classification === 'ACTIONABLE' && !normalized.title) {
    throw new InvalidDetectionCandidateError('Actionable detection must have a title');
  }
  if (normalized.classification !== 'ACTIONABLE' && normalized.title) {
    throw new InvalidDetectionCandidateError('Non-actionable detection cannot have a title');
  }
  validateDeadline(normalized);
  return normalized;
}

function validateDeadline(candidate: DetectionCandidate): void {
  const invalid = (message: string): never => {
    throw new InvalidDetectionCandidateError(message);
  };
  switch (candidate.deadlineKind) {
    case 'EXACT_DATETIME': {
      const deadlineAt = candidate.deadlineAt;
      if (!deadlineAt || candidate.deadlineDate || candidate.deadlineDependency) {
        throw new InvalidDetectionCandidateError('Exact deadline requires only deadlineAt');
      }
      if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(deadlineAt)) {
        invalid('Exact deadline must include an explicit timezone offset');
      }
      const date = new Date(deadlineAt);
      if (Number.isNaN(date.valueOf())) invalid('Exact deadline is invalid');
      candidate.deadlineAt = date.toISOString();
      return;
    }
    case 'DATE_ONLY': {
      const deadlineDate = candidate.deadlineDate;
      if (!deadlineDate || candidate.deadlineAt || candidate.deadlineDependency) {
        throw new InvalidDetectionCandidateError('Date-only deadline requires only deadlineDate');
      }
      if (!isCalendarDate(deadlineDate)) invalid('Date-only deadline is invalid');
      return;
    }
    case 'DEPENDENCY':
      if (!candidate.deadlineDependency || candidate.deadlineAt || candidate.deadlineDate) {
        invalid('Dependency deadline requires only deadlineDependency');
      }
      return;
    case 'RELATIVE':
      if (
        !candidate.deadlineRaw ||
        candidate.deadlineAt ||
        candidate.deadlineDate ||
        candidate.deadlineDependency
      ) {
        invalid('Relative deadline must remain raw and cannot invent a timestamp');
      }
      return;
    case 'UNKNOWN':
      if (candidate.deadlineAt || candidate.deadlineDate || candidate.deadlineDependency) {
        invalid('Unknown deadline cannot contain a normalized value');
      }
  }
}

function clean(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const result = value.trim();
  if (!result) return null;
  if (result.length > maximum)
    throw new InvalidDetectionCandidateError('Detection field is too long');
  return result;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}
