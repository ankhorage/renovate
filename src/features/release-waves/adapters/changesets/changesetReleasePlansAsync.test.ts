import { expect, test } from 'bun:test';

import { changesetReleasePlansAsync } from './changesetReleasePlansAsync.js';
import { changesetCheckoutFixtureAsync } from './changesetReleasePlansAsync.testSupport.js';

/*** Prove the adapter consumes a real Changesets status document from an immutable Git checkout. */
test('collects one patch publication from real Changesets status output at the pinned revision', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  try {
    const plans = await changesetReleasePlansAsync({ 'ankhorage/example': fixture });
    expect(plans.get('ankhorage/example')).toMatchObject({
      packageName: '@ankhorage/example',
      releases: [{ packageName: '@ankhorage/example', type: 'patch' }],
      version: '1.0.1',
    });
    expect(plans.get('ankhorage/example')?.statusHash).toMatch(/^[a-f0-9]{64}$/u);
    await expectImmutableRevisionFailureAsync(fixture.path);
  } finally {
    await fixture.removeAsync();
  }
});

test('rejects staged, unstaged, and untracked Changeset mutations at a trusted revision', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  try {
    await fixture.writeDirtyChangesetAsync('unstaged.md');
    await expectCleanCheckoutFailureAsync(fixture.path);
  } finally {
    await fixture.removeAsync();
  }
});

test('rejects an untracked Changeset that could alter status output', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  try {
    await fixture.writeDirtyChangesetAsync('injected.md');
    await expectCleanCheckoutFailureAsync(fixture.path);
  } finally {
    await fixture.removeAsync();
  }
});

test('rejects real Changesets output that combines more than one patch declaration', async () => {
  const fixture = await changesetCheckoutFixtureAsync({ additionalPatchChangeset: true });
  try {
    expect(await changesetReleasePlansAsync({ 'ankhorage/example': fixture })).toEqual(new Map());
  } finally {
    await fixture.removeAsync();
  }
});

/*** Assert that an inventory revision cannot redirect the adapter to a mutable checkout. */
async function expectImmutableRevisionFailureAsync(path: string): Promise<void> {
  try {
    await changesetReleasePlansAsync({ 'ankhorage/example': { path, revision: '0'.repeat(40) } });
    throw new Error('Changesets collection unexpectedly accepted a stale revision.');
  } catch (error) {
    expect(error).toHaveProperty('message', 'Changesets checkout revision is not immutable.');
  }
}

/*** Assert no worktree content can influence a pinned Changesets status calculation. */
async function expectCleanCheckoutFailureAsync(path: string): Promise<void> {
  try {
    await changesetReleasePlansAsync({
      'ankhorage/example': { path, revision: await revisionAsync(path) },
    });
    throw new Error('Changesets collection unexpectedly accepted a dirty checkout.');
  } catch (error) {
    expect(error).toHaveProperty('message', 'Changesets checkout is not clean.');
  }
}

/*** Resolve a fixture revision without coupling a dirty-worktree assertion to its helper internals. */
async function revisionAsync(path: string): Promise<string> {
  const process = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: path, stdout: 'pipe' });
  return (await new Response(process.stdout).text()).trim();
}
