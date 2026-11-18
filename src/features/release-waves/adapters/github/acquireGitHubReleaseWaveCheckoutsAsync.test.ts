import { expect, test } from 'bun:test';

import { acquireGitHubReleaseWaveCheckoutsAsync } from './acquireGitHubReleaseWaveCheckoutsAsync.js';

test('refuses to acquire publisher checkouts when every selected profile is intentionally ineligible', async () => {
  const result = acquireGitHubReleaseWaveCheckoutsAsync({
    repositories: [
      repository({ archived: true }),
      repository({ bootstrapReady: false }),
      repository({ excludedReason: 'explicit exception' }),
      repository({ private: true, publishable: false }),
    ],
    token: 'installation-token',
    useAsync: () => Promise.resolve(undefined),
  });
  const error = await result.then(
    () => new Error('Expected ineligible publisher acquisition to fail.'),
    (failure: unknown) => failure,
  );
  expect(error).toHaveProperty('message', 'Selected installation has no eligible publishers.');
});

function repository(
  overrides: Partial<
    Parameters<typeof acquireGitHubReleaseWaveCheckoutsAsync>[0]['repositories'][number]
  >,
) {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/example',
    packageName: '@ankhorage/example',
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
    sourceRevision: 'a'.repeat(40),
    ...overrides,
  };
}
