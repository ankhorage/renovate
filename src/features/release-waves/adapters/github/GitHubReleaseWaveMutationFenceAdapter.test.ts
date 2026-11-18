import { expect, test } from 'bun:test';

import { GitHubReleaseWaveMutationFenceAdapter } from './GitHubReleaseWaveMutationFenceAdapter.js';

const initial = new Date('2026-11-18T09:00:00.000Z');

test('drains an already admitted legacy rollout before it admits the coordinator', async () => {
  const adapter = fenceAdapter();
  await acquire(adapter, 'rollout-1', 'legacy');
  expect(await adapter.beginReleaseWaveCoordinatorCutoverAsync({ now: initial })).toEqual({
    activeLeases: [lease('rollout-1', 'legacy')],
    mode: 'legacy',
  });
  expect(await failureAsync(acquire(adapter, 'backlog-1', 'legacy'))).toHaveProperty(
    'message',
    'Release-wave mutation fence denies legacy admission.',
  );
  await adapter.releaseReleaseWaveMutationLeaseAsync({ leaseId: 'rollout-1', now: initial });
  expect(await adapter.beginReleaseWaveCoordinatorCutoverAsync({ now: initial })).toEqual({
    activeLeases: [],
    mode: 'coordinator',
  });
  expect(await failureAsync(acquire(adapter, 'reconcile-1', 'legacy'))).toHaveProperty(
    'message',
    'Release-wave mutation fence denies legacy admission.',
  );
  await acquire(adapter, 'coordinator-1', 'coordinator');
});

test('treats a separate reconcile run as active legacy work during cutover', async () => {
  const adapter = fenceAdapter();
  await acquire(adapter, 'reconcile-1', 'legacy');
  const cutover = await adapter.beginReleaseWaveCoordinatorCutoverAsync({ now: initial });
  expect(cutover).toEqual({ activeLeases: [lease('reconcile-1', 'legacy')], mode: 'legacy' });
});

test('retries a parallel dispatch conflict without overwriting the admitted lease', async () => {
  const store = fenceStore({ conflicts: 1 });
  const first = fenceAdapter(store);
  const second = fenceAdapter(store);
  await Promise.all([
    acquire(first, 'dispatch-1', 'legacy'),
    acquire(second, 'dispatch-2', 'legacy'),
  ]);
  const cutover = await first.beginReleaseWaveCoordinatorCutoverAsync({ now: initial });
  expect([...cutover.activeLeases.map((entry) => entry.leaseId)].sort()).toEqual([
    'dispatch-1',
    'dispatch-2',
  ]);
});

test('allows a restarted workflow to replace only its expired lease and rejects the stale owner', async () => {
  const adapter = fenceAdapter();
  await acquire(adapter, 'interrupted-1', 'legacy');
  const afterExpiry = new Date(initial.getTime() + 61_000);
  await adapter.acquireReleaseWaveMutationLeaseAsync({
    leaseId: 'restart-1',
    mutator: 'legacy',
    now: afterExpiry,
    ttlMilliseconds: 60_000,
  });
  expect(
    await failureAsync(
      adapter.assertReleaseWaveMutationLeaseAsync({
        leaseId: 'interrupted-1',
        mutator: 'legacy',
        now: afterExpiry,
      }),
    ),
  ).toHaveProperty('message', 'Release-wave mutation lease is not active for this mutator.');
});

test('rejects a lease identifier reused by the opposite mutator', async () => {
  const adapter = fenceAdapter();
  await acquire(adapter, 'shared-run', 'legacy');
  expect(await failureAsync(acquire(adapter, 'shared-run', 'coordinator'))).toHaveProperty(
    'message',
    'Release-wave mutation fence denies coordinator admission.',
  );
});

test('permits rollback only before any coordinator mutation is authorized', async () => {
  const adapter = fenceAdapter();
  await adapter.beginReleaseWaveCoordinatorCutoverAsync({ now: initial });
  await adapter.rollbackReleaseWaveCoordinatorCutoverAsync({ now: initial });
  await acquire(adapter, 'legacy-after-rollback', 'legacy');
});

test('fails closed instead of creating a duplicate publication or replay gap after coordinator mutation', async () => {
  const adapter = fenceAdapter();
  await adapter.beginReleaseWaveCoordinatorCutoverAsync({ now: initial });
  await acquire(adapter, 'coordinator-1', 'coordinator');
  await adapter.recordReleaseWaveCoordinatorMutationAsync({
    leaseId: 'coordinator-1',
    now: initial,
  });
  await adapter.releaseReleaseWaveMutationLeaseAsync({ leaseId: 'coordinator-1', now: initial });
  expect(
    await failureAsync(adapter.rollbackReleaseWaveCoordinatorCutoverAsync({ now: initial })),
  ).toHaveProperty(
    'message',
    'Release-wave coordinator cutover cannot roll back after a mutation.',
  );
});

/** Build the production adapter over a deterministic in-memory GitHub Contents boundary. */
function fenceAdapter(
  store = fenceStore(),
): ReturnType<typeof GitHubReleaseWaveMutationFenceAdapter> {
  return GitHubReleaseWaveMutationFenceAdapter({
    branch: 'release-wave-state',
    client: store.client,
    owner: 'ankhorage',
    repository: 'renovate',
  });
}

/** Acquire one one-minute lease using the fixed clock shared by all race scenarios. */
function acquire(
  adapter: ReturnType<typeof GitHubReleaseWaveMutationFenceAdapter>,
  leaseId: string,
  mutator: 'coordinator' | 'legacy',
) {
  return adapter.acquireReleaseWaveMutationLeaseAsync({
    leaseId,
    mutator,
    now: initial,
    ttlMilliseconds: 60_000,
  });
}

/** Reconstruct the expected persisted lease without coupling assertions to its JSON envelope. */
function lease(leaseId: string, mutator: 'coordinator' | 'legacy') {
  return { expiresAt: '2026-11-18T09:01:00.000Z', leaseId, mutator };
}

/** Capture an asynchronous rejection as an assertion-friendly value without an ambient test runner helper. */
async function failureAsync(value: Promise<unknown>): Promise<Error> {
  const failure = await value.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(failure instanceof Error)) throw new Error('Expected the operation to fail.');
  return failure;
}

/** Simulate GitHub's SHA precondition and an optional concurrent writer conflict. */
function fenceStore(input: { readonly conflicts?: number } = {}) {
  let { conflicts = 0 } = input;
  let content: string | undefined;
  let revision = 0;
  const client = {
    repos: {
      createOrUpdateFileContents: (value: { readonly content: string; readonly sha?: string }) => {
        if (conflicts > 0) {
          conflicts -= 1;
          return Promise.reject(Object.assign(new Error('conflict'), { status: 409 }));
        }
        const current = content === undefined ? undefined : String(revision);
        if (value.sha !== current)
          return Promise.reject(Object.assign(new Error('conflict'), { status: 422 }));
        const { content: nextContent } = value;
        content = nextContent;
        revision += 1;
        return Promise.resolve({ data: { content: { sha: String(revision) } } });
      },
      getContent: () => {
        if (content === undefined)
          return Promise.reject(Object.assign(new Error('missing'), { status: 404 }));
        return Promise.resolve({
          data: { content, encoding: 'base64', sha: String(revision), type: 'file' },
        });
      },
    },
  };
  return { client };
}
