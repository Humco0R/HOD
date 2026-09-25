import { fileURLToPath } from 'node:url';

import type { GoldenDetectionCase } from './golden-dataset';
import { createGoldenDataset } from './golden-dataset';

export function validateGoldenDataset(dataset: GoldenDetectionCase[]): void {
  if (dataset.length < 150 || dataset.length > 300) {
    throw new Error(
      `Golden dataset must contain 150-300 cases; received ${String(dataset.length)}`,
    );
  }
  const ids = new Set<string>();
  for (const item of dataset) {
    if (ids.has(item.id)) throw new Error(`Duplicate golden case id: ${item.id}`);
    ids.add(item.id);
    if (!item.text.trim()) throw new Error(`Empty text in ${item.id}`);
    if (
      item.expected.classification !== 'ACTIONABLE' &&
      item.expected.assigneeReferenceOneOf.length > 0
    ) {
      throw new Error(`Non-actionable case ${item.id} cannot require an assignee`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dataset = createGoldenDataset();
  validateGoldenDataset(dataset);
  const summary = Object.fromEntries(
    ['DIRECT', 'DISCUSSION', 'UNCERTAIN', 'AMBIGUOUS'].map((category) => [
      category,
      dataset.filter((item) => item.category === category).length,
    ]),
  );
  process.stdout.write(`${JSON.stringify({ cases: dataset.length, categories: summary })}\n`);
}
