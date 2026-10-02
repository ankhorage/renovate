import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import * as packageApi from './index.js';

const defaultPreset = readFileSync(new URL('../default.json', import.meta.url), 'utf8');
const ownerPresets = [
  readFileSync(new URL('../devtools-owner.json', import.meta.url), 'utf8'),
  readFileSync(new URL('../policy-owner.json', import.meta.url), 'utf8'),
];

test('keeps the bootstrap TypeScript API intentionally empty', () => {
  expect(Object.keys(packageApi)).toEqual([]);
});

test('lets GitHub merge every validated Renovate pull request without concurrency caps', () => {
  expect(defaultPreset).toContain('"prConcurrentLimit": 0');
  expect(defaultPreset).toContain('"branchConcurrentLimit": 0');

  for (const preset of [defaultPreset, ...ownerPresets]) {
    expect(preset).not.toContain('"platformAutomerge": false');

    const automergeRuleCount = [...preset.matchAll(/"automerge": true/gu)].length;
    const platformAutomergeRuleCount = [...preset.matchAll(/"platformAutomerge": true/gu)].length;

    expect(automergeRuleCount).toBeGreaterThan(0);
    expect(platformAutomergeRuleCount).toBe(automergeRuleCount);
  }
});
