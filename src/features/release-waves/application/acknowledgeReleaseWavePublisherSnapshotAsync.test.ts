import { expect, test } from 'bun:test';

import type { ReleaseWavePublisherSnapshotAck } from '../ports/releaseWavePublisherSnapshot.js';
import { acknowledgeReleaseWavePublisherSnapshotAsync } from './acknowledgeReleaseWavePublisherSnapshotAsync.js';

test('persists one complete epoch before returning an idempotent request-bound acknowledgement', async () => {
  const acknowledgements = new Map<string, ReleaseWavePublisherSnapshotAck>();
  const input = snapshotInput(acknowledgements);
  const first = await acknowledgeReleaseWavePublisherSnapshotAsync(input);
  const replay = await acknowledgeReleaseWavePublisherSnapshotAsync(input);
  expect(first).toEqual(replay);
  expect(first.epochId).toBe('d'.repeat(64));
});

function snapshotInput(acknowledgements: Map<string, ReleaseWavePublisherSnapshotAck>) {
  return {
    ackPort: {
      loadReleaseWavePublisherSnapshotAckAsync: (requestId: string) =>
        Promise.resolve(acknowledgements.get(requestId)),
      saveReleaseWavePublisherSnapshotAckAsync: (ack: {
        readonly changesetsStatusHash: string;
        readonly epochId: string;
        readonly requestId: string;
        readonly sourceRepository: string;
        readonly sourceSha: string;
      }) => {
        acknowledgements.set(ack.requestId, ack);
        return Promise.resolve(ack);
      },
    },
    inventoryId: 'a'.repeat(64),
    publicationDecisions: decisions(),
    publisherEpochWriterPort: {
      adoptReleaseWavePublisherEpochAsync: () =>
        Promise.resolve({
          id: 'd'.repeat(64),
          inventoryId: 'a'.repeat(64),
          publishers: [],
          sourceRevision: 'e'.repeat(40),
        }),
    },
    repositories: [repository()],
    request: request(),
  };
}

function decisions() {
  return new Map([
    [
      'ankhorage/base',
      {
        releasePlan: {
          packageName: '@ankhorage/base',
          releases: [{ packageName: '@ankhorage/base', type: 'patch' as const }],
          revision: 'b'.repeat(40),
          statusHash: 'c'.repeat(64),
          version: '1.0.1',
        },
        revision: 'b'.repeat(40),
        statusHash: 'c'.repeat(64),
      },
    ],
  ]);
}

function repository() {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/base',
    packageName: '@ankhorage/base',
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
    sourceRevision: 'b'.repeat(40),
  };
}

function request() {
  return {
    changesetsStatusHash: 'c'.repeat(64),
    requestId: 'publisher-request-0001',
    sourceRepository: 'ankhorage/base',
    sourceSha: 'b'.repeat(40),
  };
}
