import { expect, test } from 'bun:test';

import { isReleaseWaveCheckpointConflict } from '../../ports/releaseWaveCheckpoint.js';
import { GitHubReleaseWaveCheckpointAdapter } from './GitHubReleaseWaveCheckpointAdapter.js';

const checkpoint = {
  ledger: { nodes: { 'ankhorage/a': 'ready' as const }, runId: 'wave-1' },
  plan: {
    blocked: [],
    excluded: [],
    nodes: [],
    pendingBootstrap: [],
    runId: 'wave-1',
    waves: [],
  },
};

/*** Create a deterministic GitHub Contents client fixture for checkpoint adapter acceptance. */
function client(overrides: Partial<{ readonly get: unknown; readonly put: unknown }> = {}) {
  return {
    repos: {
      createOrUpdateFileContents: (input: { readonly sha?: string }) => {
        if (overrides.put instanceof Error) throw overrides.put;
        return Promise.resolve({
          data: { content: { sha: input.sha === undefined ? 'created' : 'updated' } },
        });
      },
      getContent: () => {
        if (overrides.get instanceof Error) throw overrides.get;
        return Promise.resolve({
          data: {
            content: Buffer.from(JSON.stringify(checkpoint)).toString('base64'),
            encoding: 'base64',
            sha: 'revision-1',
            type: 'file',
          },
        });
      },
    },
  };
}

test('loads and revisioned-compares GitHub-backed durable checkpoint state', async () => {
  const adapter = GitHubReleaseWaveCheckpointAdapter({
    branch: 'release-wave-state',
    client: client(),
    owner: 'ankhorage',
    repository: 'renovate',
  });

  expect(await adapter.loadReleaseWaveCheckpointAsync('wave-1')).toEqual({
    checkpoint,
    revision: 'revision-1',
  });
  expect(await adapter.saveReleaseWaveCheckpointAsync('wave-1', checkpoint, 'revision-1')).toEqual({
    checkpoint,
    revision: 'updated',
  });
});

test('treats missing state as a new durable checkpoint and exposes CAS conflicts', async () => {
  const missing = Object.assign(new Error('missing'), { status: 404 });
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  const adapter = GitHubReleaseWaveCheckpointAdapter({
    branch: 'release-wave-state',
    client: client({ get: missing, put: conflict }),
    owner: 'ankhorage',
    repository: 'renovate',
  });

  expect(await adapter.loadReleaseWaveCheckpointAsync('wave-2')).toBeUndefined();
  try {
    await adapter.saveReleaseWaveCheckpointAsync('wave-2', checkpoint, undefined);
    throw new Error('Expected checkpoint conflict.');
  } catch (error) {
    expect(isReleaseWaveCheckpointConflict(error)).toBe(true);
  }
});
