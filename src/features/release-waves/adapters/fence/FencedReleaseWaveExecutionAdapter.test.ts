import { expect, test } from 'bun:test';

import { FencedReleaseWaveExecutionAdapter } from './FencedReleaseWaveExecutionAdapter.js';

test('checks and records the authoritative coordinator fence immediately before a mutating execution', async () => {
  const calls: string[] = [];
  const adapter = fencedAdapter(calls);
  await adapter.ensureReleaseWaveRepositoryAsync({
    node: {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: undefined,
      packageName: '@ankhorage/example',
      repository: 'ankhorage/example',
      requiresNpmPublication: true,
    },
    operationId: 'operation',
    runId: 'run',
  });
  expect(calls).toEqual(['assert', 'record', 'mutation']);
});

/** Build a complete execution port fixture while retaining the observable mutation ordering. */
function fencedAdapter(calls: string[]) {
  return FencedReleaseWaveExecutionAdapter({
    executionPort: {
      collectReleaseWaveCandidatePublicationAsync: ({ node }) =>
        Promise.resolve({
          packageName: node.packageName,
          releases: [{ packageName: node.packageName, type: 'patch' }],
          revision: 'revision',
          statusHash: 'status',
          version: '1.0.1',
        }),
      ensureReleaseWaveRepositoryAsync: () => {
        calls.push('mutation');
        return Promise.resolve();
      },
      reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('missing'),
      verifyReleaseWaveRepositoryAsync: () =>
        Promise.resolve({
          documentationGenerated: false,
          exactHeadCiPassed: false,
          lockfileUpdated: false,
          releaseWorkflowPassed: false,
          requiredReviewsApproved: false,
        }),
    },
    fencePort: {
      acquireReleaseWaveMutationLeaseAsync: () => Promise.reject(new Error('unexpected')),
      assertReleaseWaveMutationLeaseAsync: () => {
        calls.push('assert');
        return Promise.resolve();
      },
      beginReleaseWaveCoordinatorCutoverAsync: () => Promise.reject(new Error('unexpected')),
      recordReleaseWaveCoordinatorMutationAsync: () => {
        calls.push('record');
        return Promise.resolve();
      },
      releaseReleaseWaveMutationLeaseAsync: () => Promise.reject(new Error('unexpected')),
      rollbackReleaseWaveCoordinatorCutoverAsync: () => Promise.reject(new Error('unexpected')),
    },
    leaseId: 'coordinator-1',
    now: () => new Date('2026-11-18T09:00:00.000Z'),
  });
}
