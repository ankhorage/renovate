import { expect, test } from 'bun:test';

import { changesetReleasePlansAsync } from './changesetReleasePlansAsync.js';
import { changesetCheckoutFixtureAsync } from './changesetReleasePlansAsync.testSupport.js';

/*** Prove the adapter consumes a real Changesets status document from an immutable Git checkout. */
test('collects one patch publication from real Changesets status output at the pinned revision', async () => {
  const fixture = await changesetCheckoutFixtureAsync();
  try {
    expect(await changesetReleasePlansAsync({ 'ankhorage/example': fixture })).toEqual(
      new Map([
        [
          'ankhorage/example',
          {
            packageName: '@ankhorage/example',
            releases: [{ packageName: '@ankhorage/example', type: 'patch' }],
            version: '1.0.1',
          },
        ],
      ]),
    );
    await expectImmutableRevisionFailureAsync(fixture.path);
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
