import { expect, test } from 'bun:test';

import { readPreset } from './renovatePreset.testSupport';

const consumerPreset = readPreset('../default.json');

test('widens npm peer dependency ranges after package-specific grouping rules', () => {
  const peerRule = consumerPreset.packageRules.at(-1);
  expect(peerRule).toMatchObject({
    matchDatasources: ['npm'],
    matchDepTypes: ['peerDependencies'],
    rangeStrategy: 'widen',
  });
});
