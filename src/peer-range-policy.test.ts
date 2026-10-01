import { expect, test } from 'bun:test';

import { readPreset } from './renovatePreset.testSupport';

const consumerPreset = readPreset('../default.json');

test('requires deliberate platform release-line upgrades before widening peers', () => {
  const [reactNativeRule, expoRule, peerRule] = consumerPreset.packageRules.slice(-3);
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
});
