import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const rolloutWorkflow = readFileSync(
  new URL('../.github/workflows/rollout-package-release.yml', import.meta.url),
  'utf8',
);

test('isolates package-release concurrency by package identity', () => {
  expect(rolloutWorkflow).toContain(
    'group: package-release-rollout-${{ github.event.client_payload.package_name || inputs.package_name }}',
  );
  expect(rolloutWorkflow).toContain('cancel-in-progress: false');
  expect(rolloutWorkflow).not.toContain('group: package-release-rollout\n');
});
