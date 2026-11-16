import { expect, test } from 'bun:test';

import type {
  ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointPort,
} from '../ports/releaseWaveCheckpoint.js';
import { ReleaseWaveCheckpointConflictError } from '../ports/releaseWaveCheckpoint.js';
import type { ReleaseWaveEventQueuePort } from '../ports/releaseWaveEventQueue.js';
import { ReleaseWaveEventQueueConflictError } from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { ingestReleaseWaveEventAsync } from './ingestReleaseWaveEventAsync.js';
import { runReleaseWaveCoordinatorAsync } from './runReleaseWaveCoordinatorAsync.js';

test('coalesces reordered duplicates into one settled downstream update and replays interruption safely', async () => {
  const queue = eventQueue();
  await Promise.all([
    ingestReleaseWaveEventAsync({
      event: event('base', '1.1.0'),
      maximumRetries: 3,
      queuePort: queue,
    }),
    ingestReleaseWaveEventAsync({
      event: event('left', '1.1.0'),
      maximumRetries: 3,
      queuePort: queue,
    }),
    ingestReleaseWaveEventAsync({
      event: event('base', '1.1.0'),
      maximumRetries: 3,
      queuePort: queue,
    }),
  ]);
  const calls: string[] = [];
  const input = coordinatorInput(queue, calls);
  const first = await runReleaseWaveCoordinatorAsync(input);
  const second = await runReleaseWaveCoordinatorAsync(input);
  expect(first?.waves).toEqual([['ankhorage/base', 'ankhorage/left'], ['ankhorage/consumer']]);
  expect(second).toBeUndefined();
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events).toHaveLength(2);
  expect(
    (await queue.loadReleaseWaveEventQueueAsync())?.queue.events.every(
      (event) => event.acknowledgedRunId !== undefined,
    ),
  ).toBe(true);
});

test('does not acknowledge an event while a required upstream publication is missing, then resumes it', async () => {
  const queue = eventQueue();
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const calls: string[] = [];
  const blocked = await runReleaseWaveCoordinatorAsync(coordinatorInput(queue, calls, []));
  expect(blocked?.blocked).toContain(
    'ankhorage/base: no verified stable published package version',
  );
  expect(
    (await queue.loadReleaseWaveEventQueueAsync())?.queue.events[0]?.acknowledgedRunId,
  ).toBeUndefined();
  const resumed = await runReleaseWaveCoordinatorAsync(coordinatorInput(queue, calls));
  expect(resumed?.blocked).toEqual([]);
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
});

/** Build a deterministic, real-graph fixture with two upstream publishers and one consumer. */
function coordinatorInput(
  queuePort: ReleaseWaveEventQueuePort,
  calls: string[],
  published = publications(),
) {
  return {
    checkpointPort: checkpointPort(),
    executionPort: executionPort(calls),
    executorId: 'test-executor',
    maximumCheckpointRetries: 3,
    maximumConcurrency: 1,
    maximumQueueRetries: 3,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    publishedPackages: published,
    queuePort,
    repositories: [
      repository('base'),
      repository('left'),
      {
        ...repository('consumer'),
        dependencies: {
          dependencies: { '@ankhorage/base': '^1.0.0', '@ankhorage/left': '^1.0.0' },
          devDependencies: {},
          optionalDependencies: {},
          peerDependencies: {},
        },
      },
    ],
  };
}

function event(name: string, version: string) {
  return { packageName: '@ankhorage/' + name, sourceRepository: 'ankhorage/' + name, version };
}

function publications() {
  return ['base', 'left', 'consumer'].map((name) => ({
    name: '@ankhorage/' + name,
    version: '1.1.0',
  }));
}

function repository(name: string) {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/' + name,
    packageName: '@ankhorage/' + name,
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
  };
}

function eventQueue(): ReleaseWaveEventQueuePort {
  let queue:
    | {
        readonly events: readonly {
          readonly eventId: string;
          readonly packageName: string;
          readonly sourceRepository: string;
          readonly version: string;
          readonly acknowledgedRunId?: string;
        }[];
      }
    | undefined;
  let revision = 0;
  return {
    loadReleaseWaveEventQueueAsync: () =>
      Promise.resolve(queue === undefined ? undefined : { queue, revision: String(revision) }),
    saveReleaseWaveEventQueueAsync: (next, expected) => {
      if (queue !== undefined && expected !== String(revision))
        throw new ReleaseWaveEventQueueConflictError();
      queue = next;
      revision += 1;
      return Promise.resolve({ queue: next, revision: String(revision) });
    },
  };
}

function checkpointPort(): ReleaseWaveCheckpointPort {
  let checkpoint: ReleaseWaveCheckpoint | undefined;
  let revision = 0;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: String(revision) },
      ),
    saveReleaseWaveCheckpointAsync: (_run, next, expected) => {
      if (checkpoint !== undefined && expected !== String(revision))
        throw new ReleaseWaveCheckpointConflictError('test');
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint: next, revision: String(revision) });
    },
  };
}

function executionPort(calls: string[]): ReleaseWaveExecutionPort {
  const candidates = new Set<string>();
  return {
    reconcileReleaseWaveRepositoryAsync: ({ node }) =>
      Promise.resolve(candidates.has(node.repository) ? 'awaiting-review' : 'missing'),
    ensureReleaseWaveRepositoryAsync: ({ node }) => {
      candidates.add(node.repository);
      calls.push('ensure:' + node.repository);
      return Promise.resolve();
    },
    verifyReleaseWaveRepositoryAsync: () =>
      Promise.resolve({
        documentationGenerated: true,
        exactHeadCiPassed: true,
        lockfileUpdated: true,
        npmArtifactVerified: true,
        npmVersionVerified: true,
        releaseWorkflowPassed: true,
        requiredReviewsApproved: true,
      }),
  };
}
