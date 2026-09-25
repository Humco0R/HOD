import { describe, expect, it } from 'vitest';

import { validateGoldenDataset } from './validate-golden';
import { createGoldenDataset } from './golden-dataset';

describe('AI golden dataset', () => {
  it('contains 150-300 unique, structurally consistent realistic cases', () => {
    const dataset = createGoldenDataset();
    expect(dataset.length).toBeGreaterThanOrEqual(150);
    expect(dataset.length).toBeLessThanOrEqual(300);
    expect(() => validateGoldenDataset(dataset)).not.toThrow();
    expect(new Set(dataset.map(({ id }) => id)).size).toBe(dataset.length);
    expect(new Set(dataset.map(({ category }) => category))).toEqual(
      new Set(['DIRECT', 'DISCUSSION', 'UNCERTAIN', 'AMBIGUOUS']),
    );
  });
});
