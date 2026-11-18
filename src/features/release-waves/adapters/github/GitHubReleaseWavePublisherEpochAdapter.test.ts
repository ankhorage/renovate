import { expect, test } from 'bun:test';

import { GitHubReleaseWavePublisherEpochAdapter } from './GitHubReleaseWavePublisherEpochAdapter.js';

test('binds immutable scheduled publishers to the selected inventory and GitHub file revision', () => {
  const adapter = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: () => Promise.resolve(file({ epochs: [epoch('inventory-1'), epoch('other')] })),
  });
  return adapter
    .loadReleaseWavePublisherEpochsAsync({
      inventoryId: 'inventory-1',
      repositories: [{} as never],
    })
    .then((epochs) =>
      expect(epochs).toEqual([{ ...epoch('inventory-1'), sourceRevision: 'a'.repeat(40) }]),
    );
});

test('fails closed for a missing matching plan', () => {
  const absent = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: () => Promise.resolve(file({ epochs: [epoch('other')] })),
  });
  return expect(
    absent.loadReleaseWavePublisherEpochsAsync({
      inventoryId: 'inventory-1',
      repositories: [{} as never],
    }),
  ).rejects.toThrow('does not cover');
});

test('fails closed for a malformed publisher schedule', () => {
  const malformed = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: () =>
      Promise.resolve(
        file({ epochs: [{ id: 'bad', inventoryId: 'inventory-1', publishers: [] }] }),
      ),
  });
  return expect(
    malformed.loadReleaseWavePublisherEpochsAsync({
      inventoryId: 'inventory-1',
      repositories: [{} as never],
    }),
  ).rejects.toThrow('malformed');
});

function epoch(inventoryId: string) {
  return {
    id: 'epoch-' + inventoryId,
    inventoryId,
    publishers: [
      { packageName: '@ankhorage/base', sourceRepository: 'ankhorage/base', version: '1.1.0' },
    ],
  };
}

function file(value: unknown): Response {
  return new Response(
    JSON.stringify({
      content: Buffer.from(JSON.stringify(value)).toString('base64'),
      encoding: 'base64',
      sha: 'a'.repeat(40),
    }),
  );
}
