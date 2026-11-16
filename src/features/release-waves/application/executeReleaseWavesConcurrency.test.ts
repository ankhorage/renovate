import { expect, test } from 'bun:test';

import type { ReleaseWavePlan } from '../../../types/releaseWave.js';
import type {
  ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointPort,
} from '../ports/releaseWaveCheckpoint.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { claimableReleaseWaveCheckpoint } from './claimableReleaseWaveCheckpoint.js';
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
  ],
  pendingBootstrap: [],
  runId: 'concurrency',
  waves: [['ankhorage/base']],
};

const completeVerification = {
  documentationGenerated: true,
  exactHeadCiPassed: true,
  lockfileUpdated: true,
  npmArtifactVerified: true,
  npmVersionVerified: true,
  releaseWorkflowPassed: true,
  requiredReviewsApproved: true,
};

test('does not concurrently verify an awaiting-review candidate with a live lease', async () => {
  const calls: string[] = [];
  const verificationStarted = Promise.withResolvers<void>();
  const verificationReleased = Promise.withResolvers<void>();
  const port: ReleaseWaveExecutionPort = {
    ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
    reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('awaiting-review'),
    verifyReleaseWaveRepositoryAsync: () => {
      calls.push('verify');
      verificationStarted.resolve();
      return verificationReleased.promise.then(() => completeVerification);
    },
  };
  const awaitingReview = checkpoint('awaiting-review', '2026-11-16T00:05:00.000Z');
  const store = checkpointPort(awaitingReview);
  const first = execute(store, port, 'first', awaitingReview.plan, '2026-11-16T00:06:00.000Z');
  await verificationStarted.promise;
  const second = await execute(
    store,
    port,
    'second',
    awaitingReview.plan,
    '2026-11-16T00:06:00.000Z',
  );
  expect(calls).toEqual(['verify']);
  expect(second.ledger.nodes['ankhorage/base']).toBe('awaiting-review');
  verificationReleased.resolve();
  await first;
});

test('reclaims an expired awaiting-review lease for verification without mutation replay', async () => {
  const calls: string[] = [];
  const expired = checkpoint('awaiting-review', '2026-11-16T00:00:00.000Z');
  const result = await execute(
    checkpointPort(expired),
    verificationPort(calls),
    'previous',
    expired.plan,
    '2026-11-16T00:00:00.000Z',
  );
  expect(result.ledger.nodes['ankhorage/base']).toBe('released');
  expect(result.ledger.operations?.['ankhorage/base']?.fencingToken).not.toBe('previous:claim');
  expect(calls).toEqual(['verify']);
});

test('generates distinct frozen-clock fencing tokens for successive claims by one executor', () => {
  const initial = checkpoint('ready');
  const input = executionInput(checkpointPort(initial), verificationPort([]), initial.plan, 'same');
  const first = claimableReleaseWaveCheckpoint(input, initial, 'ankhorage/base', false);
  const second = claimableReleaseWaveCheckpoint(input, first, 'ankhorage/base', false);
  expect(first.ledger.operations?.['ankhorage/base']?.fencingToken).not.toBe(
    second.ledger.operations?.['ankhorage/base']?.fencingToken,
  );
});

/*** Build a one-node durable checkpoint with an optional existing lease. */
function checkpoint(
  status: 'awaiting-review' | 'ready',
  leaseExpiresAt?: string,
): ReleaseWaveCheckpoint {
  return {
    ledger: {
      nodes: { 'ankhorage/base': status },
      ...(leaseExpiresAt === undefined
        ? {}
        : {
            operations: {
              'ankhorage/base': {
                fencingToken: 'previous:claim',
                leaseExpiresAt,
                operationId: 'concurrency:ankhorage/base',
                ownerId: 'previous',
              },
            },
          }),
      runId: plan.runId,
    },
    plan,
  };
}

/*** Run one executor at a deliberate fixed clock instant. */
function execute(
  checkpointPort: Parameters<typeof executionInput>[0],
  executionPort: ReleaseWaveExecutionPort,
  executorId: string,
  releasePlan: ReleaseWavePlan,
  now: string,
): Promise<ReleaseWaveCheckpoint> {
  return executeReleaseWavesAsync(
    executionInput(checkpointPort, executionPort, releasePlan, executorId, now),
  );
}

/*** Create a complete execution input with fixed limits and a frozen clock. */
function executionInput(
  checkpointPort: ReleaseWaveCheckpointPort,
  executionPort: ReleaseWaveExecutionPort,
  releasePlan: ReleaseWavePlan,
  executorId: string,
  now = '2026-11-16T00:00:00.000Z',
) {
  return {
    checkpointPort,
    executionPort,
    executorId,
    maximumCheckpointRetries: 2,
    maximumConcurrency: 1,
    now: () => new Date(now),
    plan: releasePlan,
  };
}

/*** Keep candidate reconciliation inert while recording verification-only calls. */
function verificationPort(calls: string[]): ReleaseWaveExecutionPort {
  return {
    ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
    reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('awaiting-review'),
    verifyReleaseWaveRepositoryAsync: () => {
      calls.push('verify');
      return Promise.resolve(completeVerification);
    },
  };
}

/*** Model a revisioned checkpoint store without provider behavior. */
function checkpointPort(initial: ReleaseWaveCheckpoint) {
  let checkpoint = initial;
  let revision = 0;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve({ checkpoint, revision: String(revision) }),
    saveReleaseWaveCheckpointAsync: (
      _runId: string,
      next: ReleaseWaveCheckpoint,
      expectedRevision: string | undefined,
    ) => {
      if (expectedRevision !== String(revision)) throw new Error('Unexpected checkpoint revision.');
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint, revision: String(revision) });
    },
  };
}
