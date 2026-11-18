import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import { GitHubReleaseWavePublisherEpochAdapter } from '../adapters/github/GitHubReleaseWavePublisherEpochAdapter.js';
import {
  githubContentsFixture,
  publisherDecision,
  publisherRepository,
} from './githubPublisherEpochPlanAcceptance.testSupport.js';

const revision = 'e'.repeat(40);
const inventoryId = 'a'.repeat(64);
const otherInventoryId = 'b'.repeat(64);
const endpoint =
  'https://api.github.provider-contract.test/repos/ankhorage/renovate/contents/.github/release-wave-publisher-epochs.json?ref=main';

test('reads the authenticated GitHub Contents epoch plan and binds its immutable source revision', async () => {
  const paths: string[] = [];
  const epochs = await epochAdapter(file(plan(inventoryId))).loadReleaseWavePublisherEpochsAsync({
    inventoryId,
    repositories: [{} as never],
  });

  expect(paths).toEqual([endpoint]);
  expect(epochs).toEqual([
    {
      id: epochId(inventoryId),
      inventoryId,
      publishers: [
        {
          packageName: '@ankhorage/base',
          planRevision: 'd'.repeat(40),
          planStatusHash: 'f'.repeat(64),
          sourceRepository: 'ankhorage/base',
          version: '1.1.0',
        },
      ],
      sourceRevision: revision,
    },
  ]);

  function epochAdapter(response: Response) {
    return GitHubReleaseWavePublisherEpochAdapter({
      apiBaseUrl: 'https://api.github.provider-contract.test',
      branch: 'main',
      repository: 'ankhorage/renovate',
      requestAsync: (url, init) => {
        paths.push(String(url));
        expect(init?.headers).toMatchObject({
          authorization: 'Bearer isolated-installation-token',
        });
        return Promise.resolve(response);
      },
      token: 'isolated-installation-token',
    });
  }
});

test('fails closed for a missing plan, malformed document, and mismatched selected inventory', async () => {
  const [missing, malformed, mismatched] = await Promise.all([
    failureMessageAsync(load(new Response(null, { status: 404 }), inventoryId)),
    failureMessageAsync(
      load(file({ epochs: [{ id: 'bad', inventoryId, publishers: [] }] }), inventoryId),
    ),
    failureMessageAsync(load(file(plan(otherInventoryId)), inventoryId)),
  ]);
  expect(missing).toContain('authenticated');
  expect(malformed).toContain('malformed');
  expect(mismatched).toContain('does not cover');
});

test('persists authenticated epoch A, appends independent epoch B, and reads both at the new revision', async () => {
  const contents = githubContentsFixture();
  const adapter = epochWriter(contents.requestAsync);
  const base = publisherRepository('@ankhorage/base');
  const left = publisherRepository('@ankhorage/left');
  const first = await adapter.adoptReleaseWavePublisherEpochAsync({
    inventoryId,
    publicationDecisions: new Map([[base.fullName, publisherDecision(base)]]),
    repositories: [base],
  });
  const second = await adapter.adoptReleaseWavePublisherEpochAsync({
    inventoryId,
    publicationDecisions: new Map([[left.fullName, publisherDecision(left)]]),
    repositories: [left],
  });
  const persisted = await adapter.loadReleaseWavePublisherEpochsAsync({
    inventoryId,
    repositories: [base, left],
  });

  expect(first.sourceRevision).toBe('0000000000000000000000000000000000000001');
  expect(second.sourceRevision).toBe('0000000000000000000000000000000000000002');
  expect(persisted).toEqual([{ ...first, sourceRevision: second.sourceRevision }, second]);
  expect(contents.document()).toEqual({
    epochs: persisted.map(({ sourceRevision: _sourceRevision, ...epoch }) => epoch),
  });
  expect(contents.requests.filter(({ init }) => init?.method === 'PUT')).toHaveLength(2);
  expect(contents.authorizations()).toEqual(
    Array.from({ length: contents.requests.length }, () => 'Bearer isolated-installation-token'),
  );
});

test('rejects concurrent CAS writers, overlapping schedules, and source decisions not bound to immutable selected input', async () => {
  const base = publisherRepository('@ankhorage/base');
  const left = publisherRepository('@ankhorage/left');
  const concurrent = githubContentsFixture();
  const firstWriter = epochWriter(concurrent.requestAsync);
  const secondWriter = epochWriter(concurrent.requestAsync);
  const outcomes = await Promise.allSettled([
    firstWriter.adoptReleaseWavePublisherEpochAsync({
      inventoryId,
      publicationDecisions: new Map([[base.fullName, publisherDecision(base)]]),
      repositories: [base],
    }),
    secondWriter.adoptReleaseWavePublisherEpochAsync({
      inventoryId,
      publicationDecisions: new Map([[left.fullName, publisherDecision(left)]]),
      repositories: [left],
    }),
  ]);
  const saved = concurrent.document();
  if (!isEpochDocument(saved))
    throw new Error('Concurrent winner did not persist an epoch document.');
  const overlap = githubContentsFixture({ document: saved, revision: concurrent.revision() });
  const stale = publisherRepository('@ankhorage/base', '1.0.0', 'b'.repeat(40));

  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(
    await failureMessageAsync(
      epochWriter(overlap.requestAsync).adoptReleaseWavePublisherEpochAsync({
        inventoryId,
        publicationDecisions: new Map([[base.fullName, publisherDecision(base, '1.2.0')]]),
        repositories: [base],
      }),
    ),
  ).toContain('overlaps');
  expect(
    await failureMessageAsync(
      epochWriter(githubContentsFixture().requestAsync).adoptReleaseWavePublisherEpochAsync({
        inventoryId,
        publicationDecisions: new Map([[stale.fullName, publisherDecision(base)]]),
        repositories: [stale],
      }),
    ),
  ).toContain('not bound');
});

function load(response: Response, inventoryId: string) {
  return GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.provider-contract.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    requestAsync: () => Promise.resolve(response),
    token: 'isolated-installation-token',
  }).loadReleaseWavePublisherEpochsAsync({ inventoryId, repositories: [{} as never] });
}

function epochWriter(requestAsync: (url: string | URL, init?: RequestInit) => Promise<Response>) {
  return GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: 'https://api.github.provider-contract.test',
    branch: 'main',
    repository: 'ankhorage/renovate',
    requestAsync,
    token: 'isolated-installation-token',
  });
}

function failureMessageAsync(operation: Promise<unknown>): Promise<string> {
  return operation.then(
    () => {
      throw new Error('Expected epoch-plan reader to fail.');
    },
    (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
  );
}

function isEpochDocument(value: unknown): value is { readonly epochs: readonly unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as Readonly<Record<string, unknown>>).epochs)
  );
}

function plan(inventoryId: string) {
  const publishers = [
    {
      packageName: '@ankhorage/base',
      planRevision: 'd'.repeat(40),
      planStatusHash: 'f'.repeat(64),
      sourceRepository: 'ankhorage/base',
      version: '1.1.0',
    },
  ];
  return {
    epochs: [
      {
        id: epochId(inventoryId),
        inventoryId,
        publishers,
      },
    ],
  };
}

function epochId(inventory: string): string {
  return createHash('sha256')
    .update(
      [
        inventory,
        '@ankhorage/base',
        'd'.repeat(40),
        'f'.repeat(64),
        'ankhorage/base',
        '1.1.0',
      ].join('\n'),
    )
    .digest('hex');
}

function file(value: unknown): Response {
  return new Response(
    JSON.stringify({
      content: Buffer.from(JSON.stringify(value)).toString('base64'),
      encoding: 'base64',
      sha: revision,
    }),
  );
}
