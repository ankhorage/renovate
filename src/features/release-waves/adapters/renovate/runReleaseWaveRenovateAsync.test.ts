import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const source = readFileSync(new URL('./runReleaseWaveRenovateAsync.ts', import.meta.url), 'utf8');

test('uses the controlled Ankhorage-only non-automerge Renovate candidate policy', () => {
  expect(source).toContain('RENOVATE_PACKAGE_RULES: releaseWavePackageRules()');
  expect(source).toContain('"matchPackageNames":["*"]');
  expect(source).toContain('"matchPackageNames":["@ankhorage/**"]');
  expect(source).toContain('"groupSlug":"ankhorage-release-wave"');
  expect(source).toContain('"automerge":false');
  expect(source).toContain('"platformAutomerge":false');
  expect(source).toContain('"matchUpdateTypes":["major","minor","patch"]');
});
