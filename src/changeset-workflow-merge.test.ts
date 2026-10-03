import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);
const [, afterPrepare = ''] = workflow.split('\n  commit:');
const [, mergeJob = ''] = afterPrepare.split('\n  merge:');

describe('trusted Renovate merge retry', () => {
  test('revalidates the exact head and retries only base-branch races', () => {
    expect(mergeJob).toContain('const mergeAttempts = 6;');
    expect(mergeJob).toContain('const mergeRetryDelayMs = 5000;');
    expect(mergeJob).toContain('const readMergeState = async () => {');
    expect(mergeJob).toContain('pull.head.sha !== expectedHead');
    expect(mergeJob).toContain('const [trustedLabel, reviewState, checks] = await Promise.all([');
    expect(mergeJob).toContain("throw new Error('The exact Renovate head has failing CI.')");
    expect(mergeJob).toContain('pull.mergeable !== true || checks.pending');
    expect(mergeJob).toContain('error.status === 405');
    expect(mergeJob).toContain(
      "message === 'Base branch was modified. Review and try the merge again.'",
    );
    expect(mergeJob).toContain('if (!baseBranchRace || attempt === mergeAttempts)');
    expect(mergeJob).toContain(
      'await new Promise((resolve) => setTimeout(resolve, mergeRetryDelayMs));',
    );
  });
});
