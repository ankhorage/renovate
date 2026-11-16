import { expect, test } from 'bun:test';

import { GitHubReleaseWaveEventQueueAdapter } from './GitHubReleaseWaveEventQueueAdapter.js';

test('stores the event queue with GitHub content revision compare-and-swap', async () => {
  const adapter = GitHubReleaseWaveEventQueueAdapter({
    branch: 'release-wave-state',
    client: {
      repos: {
        createOrUpdateFileContents: () => Promise.resolve({ data: { content: { sha: 'next' } } }),
        getContent: () =>
          Promise.resolve({
            data: {
              content: Buffer.from(JSON.stringify({ events: [] })).toString('base64'),
              encoding: 'base64',
              sha: 'current',
              type: 'file',
            },
          }),
      },
    },
    owner: 'ankhorage',
    repository: 'renovate',
  });
  expect(await adapter.loadReleaseWaveEventQueueAsync()).toEqual({
    queue: { events: [] },
    revision: 'current',
  });
  expect(await adapter.saveReleaseWaveEventQueueAsync({ events: [] }, 'current')).toEqual({
    queue: { events: [] },
    revision: 'next',
  });
});
