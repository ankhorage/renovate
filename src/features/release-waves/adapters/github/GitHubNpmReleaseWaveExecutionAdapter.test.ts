import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import type { ReleaseWaveVerification } from '../../ports/releaseWaveExecution.js';
import { GitHubNpmReleaseWaveExecutionAdapter } from './GitHubNpmReleaseWaveExecutionAdapter.js';

const artifact = 'published package artifact';
const artifactIntegrity = 'sha512-' + createHash('sha512').update(artifact).digest('base64');

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

/*** Prove provider verification requires real, complete GitHub and npm evidence. */
test('verifies a merged Renovate candidate only from complete provider evidence', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
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

test('does not let a merged candidate settle when npm publication is absent or from a previous latest tag', async () => {
  const verification = await verifyWith((url, method) =>
    url === 'https://registry.npm.test/%40ankhorage%2Fexample'
      ? json({
          'dist-tags': { latest: '1.2.3' },
          versions: {
            '1.2.3': { dist: { integrity: 'old', tarball: 'https://registry.npm.test/old.tgz' } },
          },
        })
      : responseFor(url, method),
  );
  expect(verification.npmArtifactVerified).toBe(false);
  expect(verification.npmVersionVerified).toBe(false);
});

test('rejects a downloadable exact-version artifact when its bytes do not match registry integrity', async () => {
  const verification = await verifyWith((url, method) =>
    url === 'https://registry.npm.test/example.tgz'
      ? new Response('tampered artifact', { status: 200 })
      : responseFor(url, method),
  );
  expect(verification.npmArtifactVerified).toBe(false);
});

test('fails closed for missing required CI, stale approval, wrong release revision, lockfile, and release-owned docs', async () => {
  const verification = await verifyWith((url, method) => {
    if (url.includes('/branches/main/protection'))
      return json({
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: { contexts: ['missing'] },
      });
    if (url.includes('/pulls/42/reviews'))
      return json([
        { state: 'APPROVED', user: { login: 'reviewer', type: 'User' } },
        { state: 'DISMISSED', user: { login: 'reviewer', type: 'User' } },
      ]);
    if (url.includes('/pulls/42/files')) return json([]);
    if (url.includes('/actions/workflows/release.yml/runs'))
      return json({ workflow_runs: [{ conclusion: 'success', head_sha: 'wrong-revision' }] });
    return responseFor(url, method);
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
  const verification = await verifyWith((url, method) =>
    url.includes('/pulls/42/reviews')
      ? new Response(null, { headers: { 'retry-after': '30' }, status: 429 })
      : responseFor(url, method),
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
  const verification = await verifyWith((url, method) =>
    url.includes('/check-runs') ? json({ items: [] }) : responseFor(url, method),
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
  const verification = await verifyWith((url, method) => {
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
    return responseFor(url, method);
  });
  expect(verification).toMatchObject({ exactHeadCiPassed: true });
});

test('accepts a CODEOWNER-protected candidate only when GitHub reports its current policy as clean', async () => {
  const verification = await verifyWith((url, method) =>
    url.includes('/branches/main/protection')
      ? json({
          required_pull_request_reviews: {
            require_code_owner_reviews: true,
            required_approving_review_count: 1,
          },
          required_status_checks: { contexts: ['validate'] },
        })
      : responseFor(url, method),
  );
  expect(verification.requiredReviewsApproved).toBe(true);
});

test('rejects a grouped candidate unless its actual manifest and lockfile adopt every planned version', async () => {
  const expectedNode = {
    ...node,
    expectedDependencies: [{ packageName: '@ankhorage/provider', version: '2.0.0' }],
  };
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url, init) =>
      Promise.resolve(
        String(url).includes('/contents/package.json?ref=base-sha')
          ? content({ dependencies: { '@ankhorage/provider': '^1.0.0' } })
          : String(url).includes('/contents/package.json?ref=candidate-sha')
            ? content({ dependencies: { '@ankhorage/provider': '^2.0.0' } })
            : String(url).includes('/contents/bun.lock?ref=candidate-sha')
              ? content('@ankhorage/provider@2.0.0')
              : responseFor(String(url), init?.method),
      ),
    token: 'test-token',
  });
  expect(
    await adapter.verifyReleaseWaveRepositoryAsync({ node: expectedNode, runId: 'wave' }),
  ).toMatchObject({ lockfileUpdated: true });
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
  return adapter.verifyReleaseWaveRepositoryAsync({ node, runId: 'wave' });
}

/*** Produce deterministic GitHub/npm provider fixtures without a live mutation target. */
function responseFor(url: string, _method: string | undefined): Response {
  if (url.includes('/issues?')) return json([{ number: 42 }]);
  if (url.includes('/branches/main/protection'))
    return json({
      required_pull_request_reviews: { required_approving_review_count: 1 },
      required_status_checks: { contexts: ['validate'] },
    });
  if (url.includes('/pulls/42/reviews'))
    return json([{ state: 'APPROVED', user: { login: 'reviewer', type: 'User' } }]);
  if (url.includes('/pulls/42/files'))
    return json([
      { filename: 'bun.lock' },
      { filename: 'package.json' },
      { filename: '.changeset/example.md' },
    ]);
  const candidateContent = candidateContentResponse(url);
  if (candidateContent !== undefined) return candidateContent;
  if (url.includes('/pulls/42'))
    return json({
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'renovate/ankhorage-release-wave', sha: 'candidate-sha' },
      mergeable: true,
      merge_commit_sha: 'merge-sha',
      mergeable_state: 'clean',
      merged_at: '2026-11-16T00:00:00Z',
      number: 42,
      state: 'closed',
      user: { login: 'author', type: 'User' },
    });
  if (url.includes('/check-runs'))
    return json({ check_runs: [{ conclusion: 'success', name: 'validate', status: 'completed' }] });
  if (url.includes('/status')) return json({ statuses: [] });
  const releaseEvidence = releaseEvidenceResponse(url);
  if (releaseEvidence !== undefined) return releaseEvidence;
  if (url.includes('/actions/workflows/release.yml/runs'))
    return json({ workflow_runs: [{ conclusion: 'success', head_sha: 'e'.repeat(40) }] });
  if (url.includes('/contents/README.md') || url.includes('/contents/paradox')) return json({});
  if (url === 'https://registry.npm.test/%40ankhorage%2Fexample')
    return json({
      'dist-tags': { latest: '1.2.3' },
      versions: {
        '1.2.4': {
          dist: { integrity: artifactIntegrity, tarball: 'https://registry.npm.test/example.tgz' },
        },
      },
    });
  if (url === 'https://registry.npm.test/example.tgz')
    return new Response(artifact, { status: 200 });
  return new Response(null, { status: 404 });
}

/** Serve immutable base and candidate content exactly as the GitHub Contents API encodes it. */
function candidateContentResponse(url: string): Response | undefined {
  if (url.includes('/contents/package.json?ref=base-sha')) return content({});
  if (url.includes('/contents/package.json?ref=candidate-sha')) return content({});
  if (url.includes('/contents/.changeset/example.md?ref=candidate-sha'))
    return content("---\n'@ankhorage/example': patch\n---\n\nRelease wave.\n");
  if (url.includes('/contents/bun.lock?ref=candidate-sha')) return content('lockfile');
  return undefined;
}

/*** Represent immutable tag and ancestry evidence without coupling it to the generic fixture router. */
function releaseEvidenceResponse(url: string): Response | undefined {
  if (url.includes('/git/ref/tags/v1.2.4'))
    return json({ object: { sha: 'tag-object', type: 'tag' } });
  if (url.includes('/git/tags/tag-object'))
    return json({ object: { sha: 'e'.repeat(40), type: 'commit' } });
  if (url.includes('/compare/merge-sha...')) return json({ status: 'ahead' });
  return undefined;
}

/*** Serialize one fixture response as GitHub/npm JSON. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

/** Encode a file response in GitHub's documented base64 Contents envelope. */
function content(value: unknown): Response {
  return json({
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
      'base64',
    ),
    encoding: 'base64',
  });
}
