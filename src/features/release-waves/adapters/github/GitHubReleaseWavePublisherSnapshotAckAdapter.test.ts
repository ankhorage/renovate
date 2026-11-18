import { expect, test } from 'bun:test';

import { GitHubReleaseWavePublisherSnapshotAckAdapter } from './GitHubReleaseWavePublisherSnapshotAckAdapter.js';

const ack = {
  changesetsStatusHash: 'a'.repeat(64),
  epochId: 'b'.repeat(64),
  requestId: 'publisher-snapshot-request-0001',
  sourceRepository: 'ankhorage/publisher',
  sourceSha: 'c'.repeat(40),
};

test('persists one canonical ACK and recovers it after a lost response', async () => {
  const contents = fakeContents();
  const port = GitHubReleaseWavePublisherSnapshotAckAdapter(contents.input());

  expect(await port.saveReleaseWavePublisherSnapshotAckAsync(ack)).toEqual(ack);
  expect(await port.saveReleaseWavePublisherSnapshotAckAsync(ack)).toEqual(ack);
  expect(await port.loadReleaseWavePublisherSnapshotAckAsync(ack.requestId)).toEqual(ack);
});

test('retries an ACK create conflict and adopts the concurrently persisted identical ACK', async () => {
  const contents = fakeContents({ conflictOnce: true });
  const port = GitHubReleaseWavePublisherSnapshotAckAdapter(contents.input());

  expect(await port.saveReleaseWavePublisherSnapshotAckAsync(ack)).toEqual(ack);
});

test('rejects a request-id replay with different immutable evidence', async () => {
  const contents = fakeContents();
  const port = GitHubReleaseWavePublisherSnapshotAckAdapter(contents.input());
  await port.saveReleaseWavePublisherSnapshotAckAsync(ack);

  try {
    await port.saveReleaseWavePublisherSnapshotAckAsync({ ...ack, sourceSha: 'd'.repeat(40) });
    throw new Error('Expected immutable replay rejection.');
  } catch (error) {
    expect(error).toHaveProperty(
      'message',
      'Release-wave publisher snapshot request id was replayed with different evidence.',
    );
  }
});

test('fails closed when the epoch was not persisted with matching publisher evidence', async () => {
  const contents = fakeContents({ epoch: { epochs: [] } });
  const port = GitHubReleaseWavePublisherSnapshotAckAdapter(contents.input());

  try {
    await port.saveReleaseWavePublisherSnapshotAckAsync(ack);
    throw new Error('Expected epoch verification rejection.');
  } catch (error) {
    expect(error).toHaveProperty(
      'message',
      'Release-wave publisher snapshot acknowledgement epoch is not durably verifiable.',
    );
  }
});

function fakeContents(input: { readonly conflictOnce?: boolean; readonly epoch?: unknown } = {}) {
  const files = new Map<string, string>();
  files.set('.github/release-wave-publisher-epochs.json', JSON.stringify(input.epoch ?? epoch()));
  let conflict = input.conflictOnce === true;
  return {
    input: () => ({
      branch: 'release-wave-state',
      client: {
        repos: {
          createOrUpdateFileContents: ({
            content,
            path,
          }: {
            readonly content: string;
            readonly path: string;
          }) => {
            if (conflict) {
              conflict = false;
              files.set(path, Buffer.from(content, 'base64').toString('utf8'));
              return Promise.reject(Object.assign(new Error('conflict'), { status: 422 }));
            }
            files.set(path, Buffer.from(content, 'base64').toString('utf8'));
            return Promise.resolve({ data: { content: { sha: 'd'.repeat(40) } } });
          },
          getContent: ({ path }: { readonly path: string }) => {
            const source = files.get(path);
            if (source === undefined)
              return Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
            return Promise.resolve({
              data: {
                content: Buffer.from(source).toString('base64'),
                encoding: 'base64',
                sha: 'e'.repeat(40),
                type: 'file',
              },
            });
          },
        },
      },
      owner: 'ankhorage',
      repository: 'renovate',
    }),
  };
}

function epoch() {
  return {
    epochs: [
      {
        id: ack.epochId,
        publishers: [
          {
            planRevision: ack.sourceSha,
            planStatusHash: ack.changesetsStatusHash,
            sourceRepository: ack.sourceRepository,
          },
        ],
      },
    ],
  };
}
