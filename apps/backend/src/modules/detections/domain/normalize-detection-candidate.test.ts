import { describe, expect, it } from 'vitest';

import type { DetectionCandidate } from './detection';
import {
  InvalidDetectionCandidateError,
  normalizeDetectionCandidate,
} from './normalize-detection-candidate';

describe('normalizeDetectionCandidate', () => {
  it('canonicalizes a timezone-aware exact datetime', () => {
    const result = normalizeDetectionCandidate(
      candidate({ deadlineKind: 'EXACT_DATETIME', deadlineAt: '2026-09-21T15:00:00+07:00' }),
    );
    expect(result.deadlineAt).toBe('2026-09-21T08:00:00.000Z');
  });

  it('keeps a real date-only deadline without inventing a time', () => {
    const result = normalizeDetectionCandidate(
      candidate({ deadlineKind: 'DATE_ONLY', deadlineDate: '2026-09-21' }),
    );
    expect(result).toMatchObject({ deadlineDate: '2026-09-21', deadlineAt: null });
  });

  it('keeps dependencies and relative phrases out of timestamp fields', () => {
    expect(
      normalizeDetectionCandidate(
        candidate({
          deadlineKind: 'DEPENDENCY',
          deadlineDependency: 'после Кирова',
          deadlineRaw: 'завтра после Кирова',
        }),
      ),
    ).toMatchObject({ deadlineDependency: 'после Кирова', deadlineAt: null });
    expect(
      normalizeDetectionCandidate(
        candidate({ deadlineKind: 'RELATIVE', deadlineRaw: 'когда освободишься' }),
      ),
    ).toMatchObject({ deadlineRaw: 'когда освободишься', deadlineAt: null });
  });

  it.each([
    { deadlineKind: 'DATE_ONLY' as const, deadlineDate: '2026-02-30' },
    { deadlineKind: 'EXACT_DATETIME' as const, deadlineAt: '2026-09-21T15:00:00' },
    { deadlineKind: 'UNKNOWN' as const, deadlineAt: '2026-09-21T08:00:00Z' },
    {
      deadlineKind: 'DEPENDENCY' as const,
      deadlineDependency: 'после поставки',
      deadlineAt: '2026-09-21T08:00:00Z',
    },
  ])('rejects contradictory or invented deadline data: $deadlineKind', (override) => {
    expect(() => normalizeDetectionCandidate(candidate(override))).toThrow(
      InvalidDetectionCandidateError,
    );
  });

  it('rejects missing actionable titles and titles attached to non-actions', () => {
    expect(() => normalizeDetectionCandidate(candidate({ title: null }))).toThrow(
      'must have a title',
    );
    expect(() =>
      normalizeDetectionCandidate(candidate({ classification: 'NOT_ACTIONABLE' })),
    ).toThrow('cannot have a title');
  });
});

function candidate(override: Partial<DetectionCandidate> = {}): DetectionCandidate {
  return {
    classification: 'ACTIONABLE',
    title: 'Проверить объект',
    assigneeReference: 'Антон',
    deadlineKind: 'UNKNOWN',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: null,
    deadlineRaw: null,
    expectedResultType: 'UNKNOWN',
    expectedResultText: null,
    location: null,
    confidence: 0.9,
    raw: {},
    ...override,
  };
}
