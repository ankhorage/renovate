import { describe, expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport.js';

const consumerPreset = readPreset('../default.json');
const devtoolsOwnerPreset = readPreset('../devtools-owner.json');

describe('Devtools-owner preset', () => {
  const effectiveRules = [...consumerPreset.packageRules, ...devtoolsOwnerPreset.packageRules];

  test('composes with the consumer default-deny boundary', () => {
    expect(devtoolsOwnerPreset.extends).toEqual(['./default']);
  });

  test('enables and groups the non-runtime Devtools root toolchain', () => {
    for (const packageName of ['eslint', 'knip', 'prettier', 'typescript']) {
      expect(resolveRules(effectiveRules, dependency(packageName))).toMatchObject({
        automerge: true,
        automergeType: 'pr',
        enabled: true,
        groupName: 'Devtools-owned toolchain',
        labels: ['dependencies', 'renovate:automerge'],
        platformAutomerge: true,
        rangeStrategy: 'bump',
      });
    }
  });

  test('automerges major owner toolchain upgrades on the latest line', () => {
    expect(
      resolveRules(effectiveRules, dependency('typescript', { updateType: 'major' })),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      allowedVersions: '<7',
      groupName: 'Devtools-owned toolchain',
      labels: ['dependencies', 'renovate:automerge'],
      separateMajorMinor: false,
    });
  });

  test('keeps non-owner manifests on the generic all-update policy', () => {
    expect(
      resolveRules(effectiveRules, dependency('eslint', { fileName: 'examples/package.json' })),
    ).toMatchObject({
      automerge: true,
      enabled: true,
      labels: ['dependencies', 'renovate:automerge'],
      separateMajorMinor: false,
    });
  });
});
