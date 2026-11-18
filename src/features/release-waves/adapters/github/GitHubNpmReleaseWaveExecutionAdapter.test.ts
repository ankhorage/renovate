import { expect, test } from 'bun:test';

import type { ReleaseWaveVerification } from '../../ports/releaseWaveExecution.js';
import { GitHubNpmReleaseWaveExecutionAdapter } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveResponseFor } from './githubReleaseWaveResponse.testSupport.js';

const node = {
  dependencies: [],
  expectedDependencies: [],
  expectedPublication: {
    version: '1.2.4',
  },
  packageName: '@ankhorage/example',
  repository: 'ankhorage/example',
  requiresNpmPublication: true,
};

const candidatePublication = {
  packageName: '@ankhorage/example',
  releases: [{ packageName: '@ankhorage/example', type: 'patch' as const }],
  revision: 'candidate-sha',
  statusHash: 'a'.repeat(64),
  version: '1.2.4',
};

/*** Prove provider verification requires real, complete GitHub and npm evidence. */
test('verifies a merged Renovate candidate only from complete provider evidence', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url, _init) => Promise.resolve(githubReleaseWaveResponseFor(String(url))),
    token: 'test-token',
  });

  expect(
    await adapter.reconcileReleaseWaveRepositoryAsync({
      node,
      operationId: 'wave:ankhorage/example',
      runId: 'wave',
    }),
  ).toBe('released');
  expect(
    await adapter.verifyReleaseWaveRepositoryAsync({ candidatePublication, node, runId: 'wave' }),
  ).toEqual({
    documentationGenerated: true,
    exactHeadCiPassed: true,
    lockfileUpdated: true,
    npmArtifactVerified: true,
    npmVersionVerified: true,
    releaseWorkflowPassed: true,
    requiredReviewsApproved: true,
  });
});

test('does not let a merged candidate settle when npm publication is absent or from a previous latest tag', async () => {
  const verification = await verifyWith((url, _method) =>
    url === 'https://registry.npm.test/%40ankhorage%2Fexample'
      ? json({
          'dist-tags': { latest: '1.2.3' },
          versions: {
            '1.2.3': { dist: { integrity: 'old', tarball: 'https://registry.npm.test/old.tgz' } },
          },
        })
      : githubReleaseWaveResponseFor(url),
  );
  expect(verification.npmArtifactVerified).toBe(false);
  expect(verification.npmVersionVerified).toBe(false);
});

test('rejects a downloadable exact-version artifact when its bytes do not match registry integrity', async () => {
  const verification = await verifyWith((url, _method) =>
    url === 'https://registry.npm.test/example.tgz'
      ? new Response('tampered artifact', { status: 200 })
      : githubReleaseWaveResponseFor(url),
  );
  expect(verification.npmArtifactVerified).toBe(false);
});

test('fails closed for missing required CI, stale approval, wrong release revision, lockfile, and release-owned docs', async () => {
  const verification = await verifyWith((url, _method) => {
    if (url.includes('/branches/main/protection'))
      return json({
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: { contexts: ['missing'] },
      });
    if (url.includes('/pulls/42/reviews'))
      return json([
        {
          commit_id: 'candidate-sha',
          state: 'APPROVED',
          user: { login: 'reviewer', type: 'User' },
        },
        {
          commit_id: 'candidate-sha',
          state: 'DISMISSED',
          user: { login: 'reviewer', type: 'User' },
        },
      ]);
    if (url.includes('/pulls/42/files')) return json([]);
    if (url.includes('/actions/workflows/release.yml/runs'))
      return json({ workflow_runs: [{ conclusion: 'success', head_sha: 'wrong-revision' }] });
    return githubReleaseWaveResponseFor(url);
  });
  expect(verification).toMatchObject({
    documentationGenerated: false,
    exactHeadCiPassed: false,
    lockfileUpdated: false,
    releaseWorkflowPassed: false,
    requiredReviewsApproved: false,
  });
});

test('treats rate limits and incomplete paginated GitHub evidence as incomplete verification', async () => {
  const verification = await verifyWith((url, _method) =>
    url.includes('/pulls/42/reviews')
      ? new Response(null, { headers: { 'retry-after': '30' }, status: 429 })
      : githubReleaseWaveResponseFor(url),
  );
  expect(verification).toEqual({
    documentationGenerated: false,
    exactHeadCiPassed: false,
    lockfileUpdated: false,
    releaseWorkflowPassed: false,
    requiredReviewsApproved: false,
  });
});

test('fails closed when a GitHub REST collection omits its documented envelope property', async () => {
  const verification = await verifyWith((url, _method) =>
    url.includes('/check-runs') ? json({ items: [] }) : githubReleaseWaveResponseFor(url),
  );
  expect(verification).toEqual({
    documentationGenerated: false,
    exactHeadCiPassed: false,
    lockfileUpdated: false,
    releaseWorkflowPassed: false,
    requiredReviewsApproved: false,
  });
});

test('reads required checks from a later documented GitHub REST page', async () => {
  const verification = await verifyWith((url, _method) => {
    if (url.includes('/check-runs') && url.endsWith('&page=1'))
      return json({
        check_runs: Array.from({ length: 100 }, (_, index) => ({
          conclusion: 'success',
          name: 'optional-' + index,
          status: 'completed',
        })),
      });
    if (url.includes('/check-runs') && url.endsWith('&page=2'))
      return json({
        check_runs: [{ conclusion: 'success', name: 'validate', status: 'completed' }],
      });
    return githubReleaseWaveResponseFor(url);
  });
  expect(verification).toMatchObject({ exactHeadCiPassed: true });
});

test('accepts a CODEOWNER-protected candidate only with an exact-head approval from the changed paths owner', async () => {
  const verification = await verifyWith((url, _method) =>
    url.includes('/branches/main/protection')
      ? json({
          required_pull_request_reviews: {
            require_code_owner_reviews: true,
            required_approving_review_count: 1,
          },
          required_status_checks: { contexts: ['validate'] },
        })
      : githubReleaseWaveResponseFor(url),
  );
  expect(verification.requiredReviewsApproved).toBe(true);
});

test('blocks an unrelated approval even when branch protection applies to administrators', async () => {
  const verification = await verifyWith((url, _method) => {
    if (url.includes('/branches/main/protection'))
      return json({
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          require_code_owner_reviews: true,
          required_approving_review_count: 1,
        },
        required_status_checks: { contexts: ['validate'] },
      });
    if (url.includes('/pulls/42/reviews'))
      return json([
        {
          commit_id: 'candidate-sha',
          state: 'APPROVED',
          user: { login: 'unrelated', type: 'User' },
        },
      ]);
    return githubReleaseWaveResponseFor(url);
  });
  expect(verification.requiredReviewsApproved).toBe(false);
});

test('blocks a CODEOWNER requirement when policy or ownership evidence cannot prove the protected decision', async () => {
  const verification = await verifyWith((url, _method) =>
    url.includes('/git/trees/base-sha') ? json({ tree: [] }) : githubReleaseWaveResponseFor(url),
  );
  expect(verification.requiredReviewsApproved).toBe(true);
  const protectedVerification = await verifyWith((url, _method) =>
    url.includes('/branches/main/protection')
      ? json({
          required_pull_request_reviews: {
            require_code_owner_reviews: true,
            required_approving_review_count: 1,
          },
          required_status_checks: { contexts: ['validate'] },
        })
      : url.includes('/git/trees/base-sha')
        ? json({ tree: [] })
        : githubReleaseWaveResponseFor(url),
  );
  expect(protectedVerification.requiredReviewsApproved).toBe(false);
});

test('rejects a merged candidate when the available approval reviewed a different head', async () => {
  const verification = await verifyWith((url, _method) =>
    url.includes('/pulls/42/reviews')
      ? json([
          {
            commit_id: 'superseded-head',
            state: 'APPROVED',
            user: { login: 'reviewer', type: 'User' },
          },
        ])
      : githubReleaseWaveResponseFor(url),
  );
  expect(verification.requiredReviewsApproved).toBe(false);
});

/*** Exercise one complete verification attempt with a focused provider override. */
async function verifyWith(
  responder: (url: string, method: string | undefined) => Response,
): Promise<ReleaseWaveVerification> {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url, init) => Promise.resolve(responder(String(url), init?.method)),
    token: 'test-token',
  });
  return adapter.verifyReleaseWaveRepositoryAsync({ candidatePublication, node, runId: 'wave' });
}

/** Serialize focused GitHub and npm fixture responses. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
