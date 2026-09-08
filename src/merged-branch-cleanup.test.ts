import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);

describe('merged Renovate branch cleanup', () => {
  test('deletes only the validated Renovate head after a successful merge', () => {
    const mergeCall = workflow.indexOf('github.rest.pulls.merge');
    const mergedResultCheck = workflow.indexOf('if (!result.data.merged)');
    const branchDeletion = workflow.indexOf('github.rest.git.deleteRef');
    const sameRepositoryGate = workflow.lastIndexOf(
      "pull.head.repo?.full_name !== owner + '/' + repo",
      mergeCall,
    );
    const renovateBranchGate = workflow.lastIndexOf(
      "!pull.head.ref.startsWith('renovate/')",
      mergeCall,
    );

    expect(sameRepositoryGate).toBeGreaterThan(-1);
    expect(renovateBranchGate).toBeGreaterThan(sameRepositoryGate);
    expect(mergeCall).toBeGreaterThan(-1);
    expect(mergedResultCheck).toBeGreaterThan(mergeCall);
    expect(branchDeletion).toBeGreaterThan(mergedResultCheck);
    expect(workflow).toContain("ref: 'heads/' + pull.head.ref");
    expect(workflow).toContain('if (error.status !== 404)');
  });
});
