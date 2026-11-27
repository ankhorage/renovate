import { expect, test } from 'bun:test';

import { dependency, readPreset, resolveRules } from './renovatePreset.testSupport';

const consumerPreset = readPreset('../default.json');

test('requires deliberate platform release-line upgrades before widening peers', () => {
  const reactNativeRule = consumerPreset.packageRules.find((rule) =>
    rule.description.includes('React Native release-line upgrades'),
  );
  const expoRule = consumerPreset.packageRules.find((rule) =>
    rule.description.includes('Expo SDK major upgrades'),
  );
  const peerRule = consumerPreset.packageRules.find((rule) =>
    rule.description.includes('Widen peer dependency compatibility'),
  );
  expect(reactNativeRule).toMatchObject({
    enabled: false,
    matchPackageNames: ['react-native'],
    matchUpdateTypes: ['minor', 'major'],
  });
  expect(expoRule).toMatchObject({
    enabled: false,
    matchPackageNames: ['expo', 'expo-*'],
    matchUpdateTypes: ['major'],
  });
  expect(peerRule).toMatchObject({
    matchDatasources: ['npm'],
    matchDepTypes: ['peerDependencies'],
    rangeStrategy: 'widen',
  });
  expect(
    resolveRules(
      consumerPreset.packageRules,
      dependency('react-native', { depType: 'peerDependencies', updateType: 'patch' }),
    ),
  ).toMatchObject({ rangeStrategy: 'widen' });
  expect(
    resolveRules(
      consumerPreset.packageRules,
      dependency('react-native', { depType: 'devDependencies', updateType: 'patch' }),
    ),
  ).toMatchObject({ rangeStrategy: 'bump' });
});

test('keeps Expo patch and minor updates eligible while requiring deliberate SDK majors', () => {
  for (const updateType of ['patch', 'minor'] as const) {
    const rule = resolveRules(
      consumerPreset.packageRules,
      dependency('expo', {
        fileName: 'examples/expo-showcase/package.json',
        updateType,
      }),
    );
    expect(rule.enabled).toBe(true);
    expect(rule.groupName).toBe(
      updateType === 'patch' ? 'Patch external npm dependencies' : 'External npm dependencies',
    );
    expect(rule.automerge).toBe(updateType === 'minor');
  }
  expect(
    resolveRules(
      consumerPreset.packageRules,
      dependency('expo', {
        fileName: 'examples/expo-showcase/package.json',
        updateType: 'major',
      }),
    ),
  ).toMatchObject({ enabled: false });
});
