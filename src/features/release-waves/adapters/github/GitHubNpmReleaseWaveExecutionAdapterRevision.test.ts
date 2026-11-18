import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWaveExecutionAdapter } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveResponseFor } from './githubReleaseWaveResponse.testSupport.js';

/** Prove review, CI, and release proof never crosses from a current PR head to stale Changesets evidence. */
test('rejects a superseded candidate revision', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url) => Promise.resolve(githubReleaseWaveResponseFor(String(url))),
    token: 'test-token',
  });

  expect(
    await adapter.verifyReleaseWaveRepositoryAsync({
      candidatePublication: {
        packageName: '@ankhorage/example',
        releases: [{ packageName: '@ankhorage/example', type: 'patch' }],
        revision: 'superseded-candidate-sha',
        statusHash: 'a'.repeat(64),
        version: '1.2.4',
      },
      node: {
        dependencies: [],
        expectedDependencies: [],
        expectedPublication: { version: '1.2.4' },
        packageName: '@ankhorage/example',
        repository: 'ankhorage/example',
        requiresNpmPublication: true,
      },
      runId: 'wave',
    }),
  ).toEqual({
    documentationGenerated: false,
    exactHeadCiPassed: false,
    lockfileUpdated: false,
    releaseWorkflowPassed: false,
    requiredReviewsApproved: false,
  });
});
