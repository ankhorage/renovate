import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import * as packageApi from './index.js';

const defaultPreset = readFileSync(new URL('../default.json', import.meta.url), 'utf8');
const ownerPresets = [readFileSync(new URL('../devtools-owner.json', import.meta.url), 'utf8')];

test('keeps the bootstrap TypeScript API intentionally empty', () => {
  expect(Object.keys(packageApi)).toEqual([]);
});

test('automerge policy keeps non-patch checks and delegates patches to the trusted gate', () => {
  const base = JSON.parse(defaultPreset) as {
    branchConcurrentLimit: number;
    prConcurrentLimit: number;
    packageRules: {
      automerge?: boolean;
      matchUpdateTypes?: string[];
      platformAutomerge?: boolean;
    }[];
  };
  expect(base.prConcurrentLimit).toBe(0);
  expect(base.branchConcurrentLimit).toBe(0);
  for (const rule of base.packageRules) {
    if (rule.matchUpdateTypes?.includes('patch')) {
      expect(rule.automerge).toBe(false);
      expect(rule.platformAutomerge).toBe(false);
    } else if (rule.automerge === true) {
      expect(rule.platformAutomerge).toBe(true);
    }
  }
  expect(ownerPresets).toHaveLength(1);
});
