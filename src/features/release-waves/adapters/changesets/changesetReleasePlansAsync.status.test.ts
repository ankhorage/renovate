import { expect, test } from 'bun:test';

import { changesetReleasePlanFromStatus } from './changesetReleasePlansAsync.js';

const manifest = { name: '@ankhorage/left', version: '1.0.0' };
const input = (status: unknown, manifestValue = manifest) =>
  [status, manifestValue, JSON.stringify(status), 'a'.repeat(40)] as const;

test('accepts only an explicit empty release list as an unchanged baseline', () => {
  expect(changesetReleasePlanFromStatus(...input({ releases: [] }))).toBeUndefined();
});

test.each([
  ['missing releases property', {}],
  ['multiple release entries', { releases: [release(), release()] }],
  ['malformed release entry', { releases: [{}] }],
  ['unsupported release type', { releases: [release({ type: 'minor' })] }],
  ['invalid release version', { releases: [release({ newVersion: 'invalid' })] }],
  ['mismatched package', { releases: [release({ name: '@ankhorage/base' })] }],
  ['mismatched package version', { releases: [release({ oldVersion: '0.9.0' })] }],
  ['duplicate Changesets', { releases: [release({ changesets: ['left', 'duplicate'] })] }],
])('rejects %s rather than creating a base-only epoch baseline', (_name, status) => {
  expect(() => changesetReleasePlanFromStatus(...input(status))).toThrow();
});

function release(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    changesets: ['left'],
    name: '@ankhorage/left',
    newVersion: '1.0.1',
    oldVersion: '1.0.0',
    type: 'patch',
    ...overrides,
  };
}
