import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/changeset.yml', import.meta.url),
  'utf8',
);
const [, afterPrepare = ''] = workflow.split('\n  commit:');
const [commitJob = '', mergeJob = ''] = afterPrepare.split('\n  merge:');

describe('trusted Renovate automerge', () => {
  test('waits for the exact eligible head and rejects review findings', () => {
    expect(mergeJob).not.toContain('id: renovate-gate-token');
    expect(mergeJob).toContain('\n      checks: read');
    expect(mergeJob).toContain('\n      issues: read');
    expect(mergeJob).toContain('\n      statuses: read');
    expect(mergeJob).toContain('github-token: ${{ github.token }}');
    expect(mergeJob).toContain("const automergeLabel = 'renovate:automerge'");
    expect(mergeJob).toContain("const reviewLabel = 'renovate:review-required'");
    expect(mergeJob).toContain("event === 'labeled'");
    expect(mergeJob).toContain("app?.slug === 'github-actions' && name === 'validate'");
    expect(mergeJob).toContain("validate.conclusion !== 'success'");
    expect(mergeJob).toContain("review.reviewDecision === 'CHANGES_REQUESTED'");
    expect(mergeJob).toContain('review.unresolved');
    expect(mergeJob).toContain('pull.head.sha !== expectedHead');
    expect(mergeJob).toContain('pull.mergeable === false');
  });

  test('merges only the unchanged validated SHA with a scoped App token', () => {
    expect(commitJob).toContain("core.setOutput('commit-created', 'true')");
    expect(mergeJob).toContain("if: needs.commit.outputs.commit-created != 'true'");
    expect(mergeJob).toContain('permission-contents: write');
    expect(mergeJob).toContain('permission-issues: read');
    expect(mergeJob).toContain('permission-pull-requests: write');
    expect(mergeJob).toContain('permission-workflows: write');
    expect(mergeJob).toContain('sha: process.env.EXPECTED_HEAD_SHA');
    expect(mergeJob).toContain("merge_method: 'squash'");
    expect(mergeJob).toContain("reviewState.reviewDecision === 'CHANGES_REQUESTED'");
    expect(mergeJob).toContain('reviewState.reviewThreads.pageInfo.hasNextPage');
  });
});
