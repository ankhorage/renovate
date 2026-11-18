import { expect, test } from 'bun:test';

import { GitHubReleaseWavePublisherEpochAdapter } from '../adapters/github/GitHubReleaseWavePublisherEpochAdapter.js';

const revision = 'e'.repeat(40);
const endpoint =
  'https://api.github.provider-contract.test/repos/ankhorage/renovate/contents/.github/release-wave-publisher-epochs.json?ref=main';

test('reads the authenticated GitHub Contents epoch plan and binds its immutable source revision', async () => {
  const paths: string[] = [];
  const epochs = await epochAdapter(file(plan('inventory-a'))).loadReleaseWavePublisherEpochsAsync({
    inventoryId: 'inventory-a',
    repositories: [{} as never],
  });

  expect(paths).toEqual([endpoint]);
  expect(epochs).toEqual([{ ...plan('inventory-a').epochs[0], sourceRevision: revision }]);

  function epochAdapter(response: Response) {
    return GitHubReleaseWavePublisherEpochAdapter({
      apiBaseUrl: 'https://api.github.provider-contract.test',
      branch: 'main',
      repository: 'ankhorage/renovate',
      requestAsync: (url, init) => {
        paths.push(String(url));
        expect(init?.headers).toMatchObject({ authorization: 'Bearer isolated-installation-token' });
        return Promise.resolve(response);
      },
      token: 'isolated-installation-token',
    });
  }
});

test('fails closed for a missing plan, malformed document, and mismatched selected inventory', async () => {
  await expect(load(new Response(null, { status: 404 }), 'inventory-a')).rejects.toThrow('authenticated');
  await expect(load(file({ epochs: [{ id: 'bad', inventoryId: 'inventory-a', publishers: [] }] }), 'inventory-a')).rejects.toThrow('malformed');
  await expect(load(file(plan('other-inventory')), 'inventory-a')).rejects.toThrow('does not cover');
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

function plan(inventoryId: string) {
  return {
    epochs: [
      {
        id: 'epoch-' + inventoryId,
        inventoryId,
        publishers: [
          {
            packageName: '@ankhorage/base',
            sourceRepository: 'ankhorage/base',
            version: '1.1.0',
          },
        ],
      },
    ],
  };
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
