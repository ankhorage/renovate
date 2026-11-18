import { expect, test } from 'bun:test';

import { GitHubReleaseWaveMutationFenceAdapter } from '../adapters/github/GitHubReleaseWaveMutationFenceAdapter.js';

const initial = new Date('2026-11-18T09:00:00.000Z');

test('keeps reconcile and coordinator mutations behind one durable cutover fence', async () => {
  const fence = GitHubReleaseWaveMutationFenceAdapter({
    branch: 'release-wave-state',
    client: contentsClient(),
    owner: 'ankhorage',
    repository: 'renovate',
  });

  await fence.acquireReleaseWaveMutationLeaseAsync({
    leaseId: 'reconcile-471',
    mutator: 'legacy',
    now: initial,
    ttlMilliseconds: 60_000,
  });
  expect(await fence.beginReleaseWaveCoordinatorCutoverAsync({ now: initial })).toMatchObject({
    mode: 'legacy',
    activeLeases: [{ leaseId: 'reconcile-471', mutator: 'legacy' }],
  });
  await fence.releaseReleaseWaveMutationLeaseAsync({ leaseId: 'reconcile-471', now: initial });
  expect(await fence.beginReleaseWaveCoordinatorCutoverAsync({ now: initial })).toMatchObject({
    activeLeases: [],
    mode: 'coordinator',
  });
  expect(
    fence.acquireReleaseWaveMutationLeaseAsync({
      leaseId: 'legacy-after-cutover',
      mutator: 'legacy',
      now: initial,
      ttlMilliseconds: 60_000,
    }),
  ).rejects.toThrow('denies legacy admission');
  await fence.acquireReleaseWaveMutationLeaseAsync({
    leaseId: 'coordinator-471',
    mutator: 'coordinator',
    now: initial,
    ttlMilliseconds: 60_000,
  });
  await fence.recordReleaseWaveCoordinatorMutationAsync({
    leaseId: 'coordinator-471',
    now: initial,
  });
  await fence.releaseReleaseWaveMutationLeaseAsync({ leaseId: 'coordinator-471', now: initial });
  expect(fence.rollbackReleaseWaveCoordinatorCutoverAsync({ now: initial })).rejects.toThrow(
    'cannot roll back after a mutation',
  );
});

/** Emulate one revisioned GitHub Contents document, including its write precondition. */
function contentsClient() {
  let content: string | undefined;
  let revision = 0;
  return {
    repos: {
      createOrUpdateFileContents: (input: { readonly content: string; readonly sha?: string }) => {
        const current = content === undefined ? undefined : String(revision);
        if (input.sha !== current)
          return Promise.reject(Object.assign(new Error('conflict'), { status: 422 }));
        const { content: nextContent } = input;
        content = nextContent;
        revision += 1;
        return Promise.resolve({ data: { content: { sha: String(revision) } } });
      },
      getContent: () => {
        if (content === undefined)
          return Promise.reject(Object.assign(new Error('missing'), { status: 404 }));
        return Promise.resolve({
          data: { content, encoding: 'base64', sha: String(revision), type: 'file' },
        });
      },
    },
  };
}
