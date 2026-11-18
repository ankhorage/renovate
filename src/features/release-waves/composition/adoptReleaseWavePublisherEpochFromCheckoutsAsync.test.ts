import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import type { ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { changesetCheckoutFixtureAsync } from '../adapters/changesets/changesetReleasePlansAsync.testSupport.js';
import type { ReleaseWavePublisherEpochWriterPort } from '../ports/releaseWavePublisherEpoch.js';
import { adoptReleaseWavePublisherEpochFromCheckoutsAsync } from './adoptReleaseWavePublisherEpochFromCheckoutsAsync.js';

test('collects the complete selected publisher decision set before one epoch adoption', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  const calls: unknown[] = [];
  try {
    await adoptReleaseWavePublisherEpochFromCheckoutsAsync({
      checkouts: { 'ankhorage/example': fixture },
      inventoryId: 'a'.repeat(64),
      publisherEpochWriterPort: writer(calls),
      repositories: [repository(fixture.revision)],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      publicationDecisions: new Map(),
    });
  } finally {
    await fixture.removeAsync();
  }
});

test('retains the planned publisher intent after versioning consumes its Changeset', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  const calls: unknown[] = [];
  try {
    await adoptReleaseWavePublisherEpochFromCheckoutsAsync({
      checkouts: { 'ankhorage/example': fixture },
      inventoryId: 'a'.repeat(64),
      publisherEpochWriterPort: writer(calls),
      repositories: [repository(fixture.revision)],
    });
    await rm(join(fixture.path, '.changeset', 'example.md'));
    expect(calls[0]).toMatchObject({
      publicationDecisions: new Map([
        [
          'ankhorage/example',
          {
            releasePlan: { packageName: '@ankhorage/example', version: '1.0.1' },
          },
        ],
      ]),
    });
  } finally {
    await fixture.removeAsync();
  }
});

test('rejects an omitted selected publisher before Changesets can be collected or persisted', () => {
  return expect(
    adoptReleaseWavePublisherEpochFromCheckoutsAsync({
      checkouts: {},
      inventoryId: 'a'.repeat(64),
      publisherEpochWriterPort: writer([]),
      repositories: [repository('b'.repeat(40))],
    }),
  ).rejects.toThrow('checkout collection is incomplete');
});

test('does not persist a partial base-only epoch when left has invalid scheduled Changesets intent', async () => {
  const base = await changesetCheckoutFixtureAsync();
  const left = await changesetCheckoutFixtureAsync({ additionalPatchChangeset: true });
  const calls: unknown[] = [];
  try {
    try {
      await adoptReleaseWavePublisherEpochFromCheckoutsAsync({
        checkouts: { 'ankhorage/base': base, 'ankhorage/left': left },
        inventoryId: 'a'.repeat(64),
        publisherEpochWriterPort: writer(calls),
        repositories: [
          { ...repository(base.revision), fullName: 'ankhorage/base' },
          { ...repository(left.revision), fullName: 'ankhorage/left' },
        ],
      });
      throw new Error('Epoch adoption unexpectedly accepted invalid left Changesets intent.');
    } catch (error) {
      expect(error).toHaveProperty(
        'message',
        'Changesets status release is not one managed patch publication.',
      );
    }
    expect(calls).toHaveLength(0);
  } finally {
    await base.removeAsync();
    await left.removeAsync();
  }
});

function writer(calls: unknown[]): ReleaseWavePublisherEpochWriterPort {
  return {
    adoptReleaseWavePublisherEpochAsync: (input) => {
      calls.push(input);
      return Promise.resolve({
        id: 'a'.repeat(64),
        inventoryId: input.inventoryId,
        publishers: [],
        sourceRevision: 'b'.repeat(40),
      });
    },
  };
}

function repository(sourceRevision: string): ReleaseWaveRepository {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/example',
    packageName: '@ankhorage/example',
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
    sourceRevision,
  };
}
