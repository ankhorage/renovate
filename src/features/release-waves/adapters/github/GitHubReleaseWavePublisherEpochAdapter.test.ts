import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import type { ChangesetReleaseDecision } from '../../../../types/releaseWave.js';
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
      inventoryId: digest('inventory-1'),
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
      inventoryId: digest('inventory-1'),
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
      inventoryId: digest('inventory-1'),
      repositories: [{} as never],
    }),
  ).rejects.toThrow('malformed');
});

test('creates a complete selected-app epoch through GitHub Contents CAS', async () => {
  const writes: RequestInit[] = [];
  const adapter = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: (_url, init) => {
      if (init?.method === 'PUT') {
        writes.push(init);
        return Promise.resolve(json({ content: { sha: 'b'.repeat(40) } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    },
  });
  const publisher = await adapter.adoptReleaseWavePublisherEpochAsync(publisherRequest());
  expect(publisher.sourceRevision).toBe('b'.repeat(40));
  expect(writes).toHaveLength(1);
  const [write] = writes;
  if (write === undefined || typeof write.body !== 'string')
    throw new Error('Expected one JSON epoch CAS write.');
  const body = JSON.parse(write.body) as { readonly content: string };
  expect(Buffer.from(body.content, 'base64').toString('utf8')).toContain('ankhorage/base');
});

test('fails closed on an epoch CAS conflict so a caller can retry from fresh immutable state', () => {
  const adapter = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: (_url, init) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? new Response(null, { status: 409 })
          : new Response(null, { status: 404 }),
      ),
  });
  return expect(adapter.adoptReleaseWavePublisherEpochAsync(publisherRequest())).rejects.toThrow(
    'CAS conflict',
  );
});

test('refuses a malicious base-only plan when selected left is also scheduled', () => {
  const adapter = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: () => Promise.resolve(new Response(null, { status: 404 })),
  });
  const request = publisherRequest();
  return expect(
    adapter.adoptReleaseWavePublisherEpochAsync({
      ...request,
      repositories: [
        ...request.repositories,
        publisherRepository('ankhorage/left', '@ankhorage/left'),
      ],
    }),
  ).rejects.toThrow('decisions are incomplete');
});

test('accepts an unchanged selected baseline only when its clean status decision is present', async () => {
  const writes: RequestInit[] = [];
  const adapter = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    token: 'token',
    requestAsync: (_url, init) => {
      if (init?.method === 'PUT') {
        writes.push(init);
        return Promise.resolve(json({ content: { sha: 'b'.repeat(40) } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    },
  });
  const request = publisherRequest();
  await adapter.adoptReleaseWavePublisherEpochAsync({
    ...request,
    publicationDecisions: new Map<string, ChangesetReleaseDecision>([
      ...request.publicationDecisions,
      ['ankhorage/left', { revision: 'c'.repeat(40), statusHash: 'd'.repeat(64) }],
    ]),
    repositories: [
      ...request.repositories,
      {
        ...publisherRepository('ankhorage/left', '@ankhorage/left'),
        sourceRevision: 'c'.repeat(40),
      },
    ],
  });
  expect(writes).toHaveLength(1);
});

function publisherRequest() {
  return {
    inventoryId: digest('selected-app'),
    publicationDecisions: new Map([
      [
        'ankhorage/base',
        {
          revision: 'a'.repeat(40),
          statusHash: 'b'.repeat(64),
          releasePlan: {
            packageName: '@ankhorage/base',
            releases: [{ packageName: '@ankhorage/base', type: 'patch' as const }],
            revision: 'a'.repeat(40),
            statusHash: 'b'.repeat(64),
            version: '1.1.0',
          },
        },
      ],
    ]),
    repositories: [publisherRepository('ankhorage/base', '@ankhorage/base')],
  };
}

function publisherRepository(fullName: string, packageName: string) {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName,
    packageName,
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
    sourceRevision: 'a'.repeat(40),
  };
}

function epoch(inventoryId: string) {
  const resolvedInventoryId =
    inventoryId === 'inventory-1' || inventoryId === 'other' ? digest(inventoryId) : inventoryId;
  const publisher = {
    packageName: '@ankhorage/base',
    planRevision: 'a'.repeat(40),
    planStatusHash: 'b'.repeat(64),
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  };
  return {
    id: digest(
      [
        resolvedInventoryId,
        publisher.packageName,
        publisher.planRevision,
        publisher.planStatusHash,
        publisher.sourceRepository,
        publisher.version,
      ].join('\n'),
    ),
    inventoryId: resolvedInventoryId,
    publishers: [publisher],
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value));
}
