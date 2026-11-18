import { expect, test } from 'bun:test';

import { ingestPackageReleaseEventAsync } from './ingestPackageReleaseEventAsync.js';
import { ingestReleaseWaveEventAsync } from './ingestReleaseWaveEventAsync.js';
import { runReleaseWaveCoordinatorAsync } from './runReleaseWaveCoordinatorAsync.js';
import {
  cohortEpoch,
  coordinatorInput,
  event,
  eventQueue,
  repository,
} from './test-support/releaseWaveFixtures.js';

test('resumes epoch A with its original checkpoint after an unrelated epoch B changes the index revision', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  const state = { epoch: cohortEpoch('epoch-a', ['base', 'left'], 'a'.repeat(40)) };
  const input = {
    ...coordinatorInput(queue, calls),
    cohortPort: {
      collectReleaseWavePublicationCohortAsync: () =>
        Promise.resolve({
          epoch: state.epoch,
          publications: [
            { ...event('base', '1.1.0'), name: '@ankhorage/base' },
            { ...event('left', '1.1.0'), name: '@ankhorage/left' },
          ],
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
        }),
    },
  };
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const first = await runReleaseWaveCoordinatorAsync(input);
  state.epoch = cohortEpoch('epoch-a', ['base', 'left'], 'b'.repeat(40));
  const resumed = await runReleaseWaveCoordinatorAsync(input);
  expect(resumed).toBeUndefined();
  expect(first?.runId).toBeDefined();
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
});

test('waits for complete settlement when base arrives first, then creates exactly one consumer release', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  const input = coordinatorInput(queue, calls);
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  expect(await runReleaseWaveCoordinatorAsync(input)).toBeUndefined();
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  const first = await runReleaseWaveCoordinatorAsync(input);
  const second = await runReleaseWaveCoordinatorAsync(input);
  expect(first?.waves).toEqual([['ankhorage/consumer']]);
  expect(second).toBeUndefined();
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events).toHaveLength(0);
  expect(
    Object.keys((await queue.loadReleaseWaveEventQueueAsync())?.queue.acknowledgedEvents ?? {}),
  ).toHaveLength(2);
});

test('releases a consumer after one scheduled publisher while an unchanged selected upstream remains a baseline', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const result = await runReleaseWaveCoordinatorAsync({
    ...coordinatorInput(queue, calls, [{ ...event('base', '1.1.0'), name: '@ankhorage/base' }]),
    cohortPort: {
      collectReleaseWavePublicationCohortAsync: () =>
        Promise.resolve({
          epoch: cohortEpoch('base-only-epoch', ['base']),
          publications: [{ ...event('base', '1.1.0'), name: '@ankhorage/base' }],
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
        }),
    },
  });
  expect(result?.waves).toEqual([['ankhorage/consumer']]);
  expect(calls).toContain('ensure:ankhorage/consumer');
});

test('does not acknowledge wrong or superseded publication evidence', async () => {
  const queue = eventQueue();
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const calls: string[] = [];
  const blocked = await runReleaseWaveCoordinatorAsync(
    coordinatorInput(queue, calls, [{ ...event('base', '1.2.0'), name: '@ankhorage/base' }]),
  );
  expect(blocked).toBeUndefined();
  expect(
    (await queue.loadReleaseWaveEventQueueAsync())?.queue.events[0]?.acknowledgedRunId,
  ).toBeUndefined();
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const resumed = await runReleaseWaveCoordinatorAsync(coordinatorInput(queue, calls));
  expect(resumed?.blocked).toEqual([]);
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
});

test('waits when a caller cohort omits a publisher scheduled by the immutable epoch', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 2,
    queuePort: queue,
  });
  const result = await runReleaseWaveCoordinatorAsync({
    ...coordinatorInput(queue, calls),
    cohortPort: {
      collectReleaseWavePublicationCohortAsync: () =>
        Promise.resolve({
          epoch: cohortEpoch('diamond-epoch', ['base', 'left']),
          publications: [{ ...event('base', '1.1.0'), name: '@ankhorage/base' }],
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
        }),
    },
  });
  expect(result).toBeUndefined();
  expect(calls).toEqual([]);
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events).toHaveLength(1);
});

test('retains compacted replay protection across later events, restart, and ingestion CAS contention', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  const input = coordinatorInput(queue, calls);
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await runReleaseWaveCoordinatorAsync(input);
  await ingestReleaseWaveEventAsync({
    event: event('other', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  expect(
    (await queue.loadReleaseWaveEventQueueAsync())?.queue.events.map((item) => item.packageName),
  ).toEqual(['@ankhorage/other']);
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
});

test('includes dev-only consumers without adding dev edges to runtime wave ordering', async () => {
  const queue = eventQueue();
  const calls: string[] = [];
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  const result = await runReleaseWaveCoordinatorAsync({
    ...coordinatorInput(queue, calls),
    cohortPort: {
      collectReleaseWavePublicationCohortAsync: () =>
        Promise.resolve({
          epoch: cohortEpoch('diamond-epoch', ['base', 'left']),
          publications: [
            { ...event('base', '1.1.0'), name: '@ankhorage/base' },
            { ...event('left', '1.1.0'), name: '@ankhorage/left' },
          ],
          repositories: [
            repository('base'),
            repository('left'),
            {
              ...repository('consumer'),
              dependencies: {
                dependencies: {},
                devDependencies: { '@ankhorage/base': '^1.0.0' },
                optionalDependencies: {},
                peerDependencies: {},
              },
            },
          ],
        }),
    },
  });
  expect(result?.waves).toEqual([['ankhorage/consumer']]);
});

test('retries CAS conflicts during both ingestion and acknowledgement without losing the ledger', async () => {
  const queue = eventQueue([1, 4]);
  const calls: string[] = [];
  await ingestReleaseWaveEventAsync({
    event: event('base', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await ingestReleaseWaveEventAsync({
    event: event('left', '1.1.0'),
    maximumRetries: 3,
    queuePort: queue,
  });
  await runReleaseWaveCoordinatorAsync(coordinatorInput(queue, calls));
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events).toEqual([]);
  expect(
    Object.keys((await queue.loadReleaseWaveEventQueueAsync())?.queue.acknowledgedEvents ?? {}),
  ).toHaveLength(2);
});

test('preserves the publisher dispatch contract while admitting only enriched event evidence', async () => {
  const queue = eventQueue();
  await ingestPackageReleaseEventAsync({
    maximumRetries: 2,
    publicationEvidencePort: {
      enrichPackageReleaseAsync: (dispatch) =>
        Promise.resolve({
          ...event('base', '1.1.0'),
          packageName: dispatch.package_name,
          sourceRepository: dispatch.source_repository,
          version: dispatch.version,
        }),
    },
    queuePort: queue,
    packageName: '@ankhorage/base',
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  });
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events[0]).toMatchObject({
    packageName: '@ankhorage/base',
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  });
});
