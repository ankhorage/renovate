import { describe, expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport.js';

const consumerPreset = readPreset('../default.json');
const devtoolsOwnerPreset = readPreset('../devtools-owner.json');

const effectiveRules = [...consumerPreset.packageRules, ...devtoolsOwnerPreset.packageRules];

test('updates the Devtools bootstrap and installed workflow digests on the same branch', () => {
  const callerPath = '.github/workflows/renovate.yml';
  const templatePath = 'src/tools/workflows/files/renovate.yml';
  const [callerManager] = consumerPreset.customManagers ?? [];
  const [templateManager] = devtoolsOwnerPreset.customManagers ?? [];
  expect(templateManager).toMatchObject({
    matchStrings: callerManager?.matchStrings,
    datasourceTemplate: callerManager?.datasourceTemplate,
    depNameTemplate: callerManager?.depNameTemplate,
    currentValueTemplate: callerManager?.currentValueTemplate,
    autoReplaceStringTemplate: callerManager?.autoReplaceStringTemplate,
  });
  const [filePattern] = templateManager?.managerFilePatterns ?? [];
  const matcher = new RegExp(filePattern?.slice(1, -1) ?? '^$');
  expect(matcher.test(templatePath)).toBe(true);
  expect(matcher.test(callerPath)).toBe(false);

  const digest = {
    datasource: 'github-digest',
    manager: 'custom.regex',
    repository: 'ankhorage/devtools',
    updateType: 'digest',
  };
  const caller = dependency('ankhorage/renovate', { ...digest, fileName: callerPath });
  const template = { ...caller, fileName: templatePath };
  const callerPolicy = resolveRules(effectiveRules, caller);
  expect(callerPolicy.groupSlug).toBe('ankhorage-renovate-workflow');
  expect(resolveRules(effectiveRules, template)).toEqual(callerPolicy);
  expect(resolveRules(consumerPreset.packageRules, template)).toEqual({ enabled: false });
  expect(resolveRules(effectiveRules, { ...template, repository: 'ankhorage/consumer' })).toEqual({
    enabled: false,
  });
});

describe('Devtools-owner preset', () => {
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
