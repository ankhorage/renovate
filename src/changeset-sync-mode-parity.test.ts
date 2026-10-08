import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);
const [prepareJob = '', afterPrepare = ''] = workflow.split('\n  commit:');
const [commitJob = ''] = afterPrepare.split('\n  merge:');

const toolchainPattern = /const toolchainNames = new Set\(\[([^\]]+)\]\);/u;

/*** Reads the canonical toolchain dependency names checked in one synchronization stage. */
function readToolchainNames(job: string): string[] {
  const declaration = toolchainPattern.exec(job)?.[1];
  if (declaration === undefined) throw new Error('Missing toolchain dependency classifier.');
  return [...declaration.matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '');
}

describe('Renovate sync mode parity', () => {
  test('prepare and commit classify identical toolchain dependencies', () => {
    expect(readToolchainNames(prepareJob)).toEqual(readToolchainNames(commitJob));
    expect(readToolchainNames(prepareJob)).toEqual(['@ankhorage/ankh', '@ankhorage/devtools']);
  });

  test('preserves the commit-side sync mode integrity check', () => {
    expect(commitJob).toContain('artifact.syncMode !== expectedSyncMode');
    expect(commitJob).toContain('Managed artifact sync mode no longer matches the pull request.');
  });
});
