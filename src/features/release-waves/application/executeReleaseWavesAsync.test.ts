import { expect, test } from 'bun:test';

import type { ReleaseWavePlan } from '../../../types/releaseWave.js';
import {
  type ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointConflictError,
  type ReleaseWaveCheckpointPort,
} from '../ports/releaseWaveCheckpoint.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { executeReleaseWavesAsync } from './executeReleaseWavesAsync.js';

const plan: ReleaseWavePlan = {
  blocked: [],
  excluded: [],
  nodes: [
    {
      dependencies: [],
      packageName: '@ankhorage/base',
      repository: 'ankhorage/base',
      requiresNpmPublication: true,
    },
    {
      dependencies: ['ankhorage/base'],
      packageName: '@ankhorage/left',
      repository: 'ankhorage/left',
      requiresNpmPublication: true,
    },
    {
      dependencies: ['ankhorage/base'],
      packageName: '@ankhorage/right',
      repository: 'ankhorage/right',
      requiresNpmPublication: true,
    },
    {
      dependencies: ['ankhorage/left', 'ankhorage/right'],
      packageName: '@ankhorage/consumer',
      repository: 'ankhorage/consumer',
      requiresNpmPublication: true,
    },
  ],
  pendingBootstrap: [],
  runId: 'diamond',
  waves: [['ankhorage/base'], ['ankhorage/left', 'ankhorage/right'], ['ankhorage/consumer']],
};

/*** Create a revisioned in-memory checkpoint port that models GitHub Contents compare-and-swap. */
function checkpointPort(conflicts = 0): ReleaseWaveCheckpointPort {
  let checkpoint: ReleaseWaveCheckpoint | undefined;
  let revision = 0;
  let remainingConflicts = conflicts;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: String(revision) },
      ),
    saveReleaseWaveCheckpointAsync: (_runId, next, expectedRevision) => {
      if (remainingConflicts > 0) {
        remainingConflicts -= 1;
        throw new ReleaseWaveCheckpointConflictError('diamond');
      }
      if (checkpoint !== undefined && expectedRevision !== String(revision)) {
        throw new ReleaseWaveCheckpointConflictError('diamond');
      }
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint, revision: String(revision) });
    },
  };
}

/*** Create an idempotent consumer-PR gateway with complete release proof. */
function executionPort(calls: string[], blocked = false): ReleaseWaveExecutionPort {
  const pullRequests = new Set<string>();
  return {
    ensureReleaseWaveRepositoryAsync: ({ node }) => {
      pullRequests.add(node.repository);
      calls.push('update:' + node.repository);
      return Promise.resolve();
    },
    verifyReleaseWaveRepositoryAsync: ({ node }) => {
      calls.push('verify:' + node.repository);
      return Promise.resolve({
        documentationGenerated: true,
        exactHeadCiPassed: !blocked || node.repository !== 'ankhorage/base',
        lockfileUpdated: true,
        npmArtifactVerified: true,
        npmVersionVerified: true,
        releaseWorkflowPassed: true,
        requiredReviewsApproved: true,
      });
    },
  };
}

test('settles a diamond once and creates exactly one coordinated consumer release', async () => {
  const calls: string[] = [];
  const input = {
    checkpointPort: checkpointPort(1),
    executionPort: executionPort(calls),
    maximumCheckpointRetries: 3,
    maximumConcurrency: 2,
    plan,
  };

  const first = await executeReleaseWavesAsync(input);
  const second = await executeReleaseWavesAsync(input);

  expect(first.ledger.nodes).toEqual({
    'ankhorage/base': 'released',
    'ankhorage/consumer': 'released',
    'ankhorage/left': 'released',
    'ankhorage/right': 'released',
  });
  expect(second).toEqual(first);
  expect(calls.filter((call) => call === 'update:ankhorage/consumer')).toEqual([
    'update:ankhorage/consumer',
  ]);
});

test('holds later waves when an exact-head CI gate is incomplete', async () => {
  const calls: string[] = [];
  const result = await executeReleaseWavesAsync({
    checkpointPort: checkpointPort(),
    executionPort: executionPort(calls, true),
    maximumCheckpointRetries: 2,
    maximumConcurrency: 2,
    plan,
  });

  expect(result.ledger.nodes['ankhorage/base']).toBe('awaiting-review');
  expect(calls).toEqual(['update:ankhorage/base', 'verify:ankhorage/base']);
});
