import { expect, test } from 'bun:test';

import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
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

test('fails closed for corrupted event identities, duplicate content, and invalid acknowledgement state', async () => {
  const event = {
    eventId: '',
    npmArtifactIntegrity: 'sha512-YmFzZQ==',
    packageName: '@ankhorage/base',
    releaseId: 'base-1.1.0',
    releaseTag: 'v1.1.0',
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  };
  const canonical = { ...event, eventId: releaseWaveEventIdentity(event) };
  for (const queue of [
    { events: [{ ...canonical, eventId: 'wrong' }] },
    { events: [canonical, canonical] },
    { acknowledgedEvents: { [canonical.eventId]: '' }, events: [] },
    { events: [{ ...canonical, acknowledgedRunId: 'wave' }] },
  ]) {
    const adapter = GitHubReleaseWaveEventQueueAdapter({
      branch: 'release-wave-state',
      client: {
        repos: {
          createOrUpdateFileContents: () => Promise.resolve({ data: { content: { sha: 'next' } } }),
          getContent: () =>
            Promise.resolve({
              data: {
                content: Buffer.from(JSON.stringify(queue)).toString('base64'),
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
    const failure = await adapter.loadReleaseWaveEventQueueAsync().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Release-wave event queue');
  }
});
