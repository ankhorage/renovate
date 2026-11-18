import { expect, test } from 'bun:test';

import type { ReleaseWaveEventQueuePort } from '../ports/releaseWaveEventQueue.js';
import { ReleaseWaveEventQueueConflictError } from '../ports/releaseWaveEventQueue.js';
import { admitVerifiedPackageReleaseEventAsync } from './admitVerifiedPackageReleaseEventAsync.js';

test('persists verified publisher evidence while epoch recovery remains unavailable', async () => {
  const queuePort = eventQueue();
  const event = await admitVerifiedPackageReleaseEventAsync({
    maximumRetries: 2,
    packageName: '@ankhorage/base',
    publicationEvidencePort: {
      enrichPackageReleaseAsync: (dispatch) =>
        Promise.resolve({
          npmArtifactIntegrity: 'sha512-YmFzZQ==',
          packageName: dispatch.package_name,
          releaseId: 'base-1.1.0',
          releaseTag: 'v1.1.0',
          sourceRepository: dispatch.source_repository,
          version: dispatch.version,
        }),
    },
    queuePort,
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  });
  expect((await queuePort.loadReleaseWaveEventQueueAsync())?.queue.events).toEqual([event]);
});

test('recovers staggered publisher events through a restart, delayed evidence, replay, and CAS conflict', async () => {
  const state = queueState(1);
  const admit = (packageName: string, version = '1.1.0') =>
    admitVerifiedPackageReleaseEventAsync({
      maximumRetries: 2,
      packageName,
      publicationEvidencePort: {
        enrichPackageReleaseAsync: (dispatch) =>
          Promise.resolve({
            npmArtifactIntegrity: 'sha512-YmFzZQ==',
            packageName: dispatch.package_name,
            releaseId: dispatch.package_name + '-' + dispatch.version,
            releaseTag: 'v' + dispatch.version,
            sourceRepository: dispatch.source_repository,
            version: dispatch.version,
          }),
      },
      queuePort: state.port,
      sourceRepository: 'ankhorage/' + packageName.slice('@ankhorage/'.length),
      version,
    });
  await admit('@ankhorage/base');
  const restarted = state.port;
  await admit('@ankhorage/left');
  await admit('@ankhorage/base');
  expect(
    (await restarted.loadReleaseWaveEventQueueAsync())?.queue.events.map(
      (event) => event.packageName,
    ),
  ).toEqual(['@ankhorage/base', '@ankhorage/left']);
});

function eventQueue(): ReleaseWaveEventQueuePort {
  let state: Awaited<ReturnType<ReleaseWaveEventQueuePort['loadReleaseWaveEventQueueAsync']>>;
  return {
    loadReleaseWaveEventQueueAsync: () => Promise.resolve(state),
    saveReleaseWaveEventQueueAsync: (queue) => {
      state = { queue, revision: 'revision' };
      return Promise.resolve(state);
    },
  };
}

function queueState(conflicts: number): { readonly port: ReleaseWaveEventQueuePort } {
  let remainingConflicts = conflicts;
  let state: Awaited<ReturnType<ReleaseWaveEventQueuePort['loadReleaseWaveEventQueueAsync']>>;
  return {
    port: {
      loadReleaseWaveEventQueueAsync: () => Promise.resolve(state),
      saveReleaseWaveEventQueueAsync: (queue) => {
        if (remainingConflicts > 0) {
          remainingConflicts -= 1;
          return Promise.reject(new ReleaseWaveEventQueueConflictError());
        }
        state = { queue, revision: 'revision' };
        return Promise.resolve(state);
      },
    },
  };
}
