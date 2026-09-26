import { expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport.js';

const consumerPreset = readPreset('../default.json');
const policyOwnerPreset = readPreset('../policy-owner.json');
const effectiveRules = [...consumerPreset.packageRules, ...policyOwnerPreset.packageRules];

test('composes with the consumer default-deny boundary', () => {
  expect(policyOwnerPreset.extends).toEqual(['./default']);
});

test('tracks the two canonical runtime literals in repository policy', () => {
  expect(policyOwnerPreset.customManagers).toEqual([
    expect.objectContaining({
      customType: 'regex',
      datasourceTemplate: 'npm',
      depNameTemplate: 'bun',
      managerFilePatterns: ['/^src\\/repository\\/policy\\.ts$/'],
      matchStrings: ["const BUN_VERSION = '(?<currentValue>[^']+)';"],
    }),
    expect.objectContaining({
      customType: 'regex',
      datasourceTemplate: 'npm',
      depNameTemplate: '@types/bun',
      managerFilePatterns: ['/^src\\/repository\\/policy\\.ts$/'],
      matchStrings: ["const BUN_TYPES_VERSION = '(?<currentValue>[^']+)';"],
    }),
  ]);
});

test('groups policy literals with matching root package updates', () => {
  for (const candidate of [
    dependency('bun', {
      fileName: 'src/repository/policy.ts',
      manager: 'custom.regex',
    }),
    dependency('@types/bun', {
      fileName: 'src/repository/policy.ts',
      manager: 'custom.regex',
    }),
    dependency('bun'),
    dependency('@types/bun'),
  ]) {
    expect(resolveRules(effectiveRules, candidate)).toMatchObject({
      automerge: true,
      automergeType: 'pr',
      enabled: true,
      groupName: 'Policy-owned runtime',
      groupSlug: 'policy-owned-runtime',
      labels: ['dependencies', 'renovate:automerge'],
      platformAutomerge: false,
    });
  }
});

test('requires review for major runtime upgrades', () => {
  expect(
    resolveRules(
      effectiveRules,
      dependency('bun', {
        fileName: 'src/repository/policy.ts',
        manager: 'custom.regex',
        updateType: 'major',
      }),
    ),
  ).toMatchObject({
    automerge: false,
    enabled: true,
    groupName: 'Policy-owned runtime',
    labels: ['dependencies', 'renovate:review-required'],
    platformAutomerge: false,
  });
});

test('does not broaden third-party updates beyond Policy-owned runtime fields', () => {
  expect(resolveRules(effectiveRules, dependency('typescript'))).toEqual({ enabled: false });
  expect(
    resolveRules(
      effectiveRules,
      dependency('bun', {
        fileName: 'examples/package.json',
      }),
    ),
  ).toEqual({ enabled: false });
});
