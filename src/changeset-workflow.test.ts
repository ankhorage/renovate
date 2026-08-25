import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);

test('keeps Renovate Changeset writes constrained and revalidates their commit', () => {
  expect(workflow).toContain("context.actor !== 'renovate[bot]'");
  expect(workflow).toContain("pull.head.ref.startsWith('renovate/')");
  expect(workflow).toContain("name.startsWith('@ankhorage/')");
  expect(workflow).toContain("workflow_id: 'ci.yml'");
  expect(workflow).not.toContain('actions/checkout');
});
