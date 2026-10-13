import { expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport.js';

const preset = readPreset('../default.json');
const effectiveRules = preset.packageRules;
const devtoolsOwnerPreset = readPreset('../devtools-owner.json');

test('detects precisely the two canonical Bun owner literals', () => {
  const source = `const BUN_VERSION = '1.4.2';
const BUN_TYPES_VERSION = '1.4.2';`;
  const managers = (preset.customManagers ?? []).filter(
    ({ depNameTemplate }) => depNameTemplate === 'bun' || depNameTemplate === '@types/bun',
  );
  expect(managers).toHaveLength(2);
  for (const manager of managers) {
    expect(manager).toMatchObject({
      customType: 'regex',
      datasourceTemplate: 'npm',
      managerFilePatterns: ['/^src\\/constants\\/repository\\.ts$/'],
    });
    const [expression] = manager.matchStrings;
    expect(expression).toBeDefined();
    const matches = [...source.matchAll(new RegExp(expression ?? '', 'gu'))];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.groups?.currentValue).toBe('1.4.2');
  }
});

test('does not widen Bun update ownership to unrelated repositories or example manifests', () => {
  for (const name of ['bun', '@types/bun']) {
    const root = dependency(name, { repository: 'ankhorage/surface' });
    const owner = dependency(name, { repository: 'ankhorage/rules-repository' });
    const ownerExample = dependency(name, {
      repository: 'ankhorage/rules-repository',
      fileName: 'examples/example/package.json',
    });
    expect(resolveRules(effectiveRules, root).enabled).toBe(false);
    expect(resolveRules(effectiveRules, owner).enabled).toBe(true);
    expect(resolveRules(effectiveRules, ownerExample).enabled).toBe(false);
  }
});

test('keeps Devtools Bun updates behind the released Rules contract', () => {
  const ownerRules = [...preset.packageRules, ...devtoolsOwnerPreset.packageRules];
  for (const name of ['bun', '@types/bun']) {
    expect(resolveRules(ownerRules, dependency(name)).enabled).toBe(false);
    expect(resolveRules(ownerRules, dependency('typescript')).enabled).toBe(true);
  }
});
