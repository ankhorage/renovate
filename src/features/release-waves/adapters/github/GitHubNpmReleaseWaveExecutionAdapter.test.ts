import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWaveExecutionAdapter } from './GitHubNpmReleaseWaveExecutionAdapter.js';

const node = {
  dependencies: [],
  packageName: '@ankhorage/example',
  repository: 'ankhorage/example',
  requiresNpmPublication: true,
};

/*** Prove provider verification requires real, complete GitHub and npm evidence. */
test('verifies a merged Renovate candidate only from complete provider evidence', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url, init) => Promise.resolve(responseFor(String(url), init?.method)),
    token: 'test-token',
  });

  expect(
    await adapter.reconcileReleaseWaveRepositoryAsync({
      node,
      operationId: 'wave:ankhorage/example',
      runId: 'wave',
    }),
  ).toBe('released');
  expect(await adapter.verifyReleaseWaveRepositoryAsync({ node, runId: 'wave' })).toEqual({
    documentationGenerated: true,
    exactHeadCiPassed: true,
    lockfileUpdated: true,
    npmArtifactVerified: true,
    npmVersionVerified: true,
    releaseWorkflowPassed: true,
    requiredReviewsApproved: true,
  });
});

/*** Produce deterministic GitHub/npm provider fixtures without a live mutation target. */
function responseFor(url: string, method: string | undefined): Response {
  if (url.includes('/issues?')) return json([{ number: 42 }]);
  if (url.includes('/pulls/42/reviews')) return json([{ state: 'APPROVED' }]);
  if (url.includes('/pulls/42/files'))
    return json([{ filename: 'bun.lock' }, { filename: 'README.md' }]);
  if (url.includes('/pulls/42'))
    return json({
      head: { ref: 'renovate/ankhorage-release-wave', sha: 'candidate-sha' },
      merge_commit_sha: 'merge-sha',
      merged_at: '2026-11-16T00:00:00Z',
      number: 42,
      state: 'closed',
    });
  if (url.includes('/check-runs'))
    return json({ check_runs: [{ conclusion: 'success', status: 'completed' }] });
  if (url.includes('/releases/latest')) return json({ target_commitish: 'merge-sha' });
  if (url === 'https://registry.npm.test/%40ankhorage%2Fexample')
    return json({
      'dist-tags': { latest: '1.2.3' },
      versions: { '1.2.3': { dist: { tarball: 'https://tarball.test/example.tgz' } } },
    });
  if (url === 'https://tarball.test/example.tgz' && method === 'HEAD')
    return new Response(null, { status: 200 });
  return new Response(null, { status: 404 });
}

/*** Serialize one fixture response as GitHub/npm JSON. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
