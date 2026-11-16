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
    reconcileReleaseWaveRepositoryAsync: ({ node }) => {
      calls.push('reconcile:' + node.repository);
      return Promise.resolve(pullRequests.has(node.repository) ? 'awaiting-review' : 'missing');
    },
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
    executorId: 'executor-1',
    maximumCheckpointRetries: 3,
    maximumConcurrency: 2,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
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
    executorId: 'executor-1',
    maximumCheckpointRetries: 2,
    maximumConcurrency: 2,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    plan,
  });

  expect(result.ledger.nodes['ankhorage/base']).toBe('awaiting-review');
  expect(calls).toEqual([
    'reconcile:ankhorage/base',
    'update:ankhorage/base',
    'verify:ankhorage/base',
  ]);
});

test('keeps a reconciled merged candidate non-terminal until npm publication evidence is complete', async () => {
  const [base] = plan.nodes;
  if (base === undefined) throw new Error('Base node fixture is missing.');
  const result = await executeReleaseWavesAsync({
    checkpointPort: checkpointPort(),
    executionPort: {
      ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
      reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('released'),
      verifyReleaseWaveRepositoryAsync: () =>
        Promise.resolve({
          documentationGenerated: true,
          exactHeadCiPassed: true,
          lockfileUpdated: true,
          npmArtifactVerified: false,
          npmVersionVerified: false,
          releaseWorkflowPassed: true,
          requiredReviewsApproved: true,
        }),
    },
    executorId: 'executor-1',
    maximumCheckpointRetries: 2,
    maximumConcurrency: 1,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    plan: { ...plan, nodes: [base], waves: [['ankhorage/base']] },
  });
  expect(result.ledger.nodes['ankhorage/base']).toBe('awaiting-review');
});

test('adopts a concurrently advanced initializer instead of overwriting its release evidence', async () => {
  const calls: string[] = [];
  const winner: ReleaseWaveCheckpoint = {
    ledger: {
      nodes: Object.fromEntries(plan.nodes.map((node) => [node.repository, 'released'] as const)),
      runId: plan.runId,
    },
    plan,
  };
  let checkpoint: ReleaseWaveCheckpoint | undefined;
  const store: ReleaseWaveCheckpointPort = {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: 'concurrent-winner' },
      ),
    saveReleaseWaveCheckpointAsync: () => {
      checkpoint = winner;
      throw new ReleaseWaveCheckpointConflictError(plan.runId);
    },
  };
  const result = await executeReleaseWavesAsync({
    checkpointPort: store,
    executionPort: executionPort(calls),
    executorId: 'losing-initializer',
    maximumCheckpointRetries: 2,
    maximumConcurrency: 2,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    plan,
  });
  expect(result).toEqual(winner);
  expect(calls).toEqual([]);
});

test('two simultaneous executors lease one repository operation and create one candidate', async () => {
  const calls: string[] = [];
  const store = checkpointPort();
  const port = executionPort(calls);
  await Promise.all(
    ['executor-1', 'executor-2'].map((executorId) =>
      executeReleaseWavesAsync({
        checkpointPort: store,
        executionPort: port,
        executorId,
        maximumCheckpointRetries: 4,
        maximumConcurrency: 2,
        now: () => new Date('2026-11-16T00:00:00.000Z'),
        plan,
      }),
    ),
  );
  expect(calls.filter((call) => call === 'update:ankhorage/consumer')).toHaveLength(1);
  expect(calls.filter((call) => call === 'update:ankhorage/base')).toHaveLength(1);
});

test('reconciles an expired interrupted mutation before retrying it', async () => {
  const calls: string[] = [];
  const [baseNode] = plan.nodes;
  if (baseNode === undefined) throw new Error('Base node fixture is missing.');
  const interrupted: ReleaseWaveCheckpoint = {
    ledger: {
      nodes: { 'ankhorage/base': 'updating' },
      operations: {
        'ankhorage/base': {
          fencingToken: 'interrupted-executor:2026-11-15T22:55:00.000Z',
          leaseExpiresAt: '2026-11-15T23:00:00.000Z',
          operationId: 'diamond:ankhorage/base',
          ownerId: 'interrupted-executor',
        },
      },
      runId: 'diamond',
    },
    plan: { ...plan, nodes: [baseNode], waves: [['ankhorage/base']] },
  };
  const store = checkpointPortWith(interrupted);
  const port: ReleaseWaveExecutionPort = {
    ensureReleaseWaveRepositoryAsync: () => {
      calls.push('update');
      return Promise.resolve();
    },
    reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('awaiting-review'),
    verifyReleaseWaveRepositoryAsync: () => {
      calls.push('verify');
      return Promise.resolve(completeVerification);
    },
  };
  const result = await executeReleaseWavesAsync({
    checkpointPort: store,
    executionPort: port,
    executorId: 'recovery-executor',
    maximumCheckpointRetries: 2,
    maximumConcurrency: 1,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    plan: interrupted.plan,
  });
  expect(result.ledger.nodes['ankhorage/base']).toBe('released');
  expect(calls).toEqual(['verify']);
});

const completeVerification = {
  documentationGenerated: true,
  exactHeadCiPassed: true,
  lockfileUpdated: true,
  npmArtifactVerified: true,
  npmVersionVerified: true,
  releaseWorkflowPassed: true,
  requiredReviewsApproved: true,
};

/** Create a revisioned checkpoint store from pre-existing durable state. */
function checkpointPortWith(initial: ReleaseWaveCheckpoint): ReleaseWaveCheckpointPort {
  let checkpoint: ReleaseWaveCheckpoint | undefined = initial;
  let revision = 0;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: String(revision) },
      ),
    saveReleaseWaveCheckpointAsync: (_runId, next, expectedRevision) => {
      if (checkpoint !== undefined && expectedRevision !== String(revision))
        throw new ReleaseWaveCheckpointConflictError('diamond');
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint, revision: String(revision) });
    },
  };
}
