import { createHash } from 'node:crypto';

import { GitHubReleaseWavePublicationCohortAdapter } from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { githubReleaseWaveResponseFor } from '../adapters/github/githubReleaseWaveResponse.testSupport.js';

export const githubApi = 'https://api.github.provider-contract.test';
export const npmRegistry = 'https://registry.npm.provider-contract.test';

export const candidatePublication = {
  packageName: '@ankhorage/example',
  releases: [{ packageName: '@ankhorage/example', type: 'patch' as const }],
  revision: 'candidate-sha',
  statusHash: 'a'.repeat(64),
  version: '1.2.4',
};

/*** Build provider event evidence with the integrity binding asserted by the cohort adapter. */
export function eventFor(dispatch: {
  readonly package_name: string;
  readonly source_repository: string;
  readonly version: string;
}) {
  return {
    npmArtifactIntegrity: integrity('base artifact'),
    packageName: dispatch.package_name,
    releaseId: 'provider-release-1',
    releaseTag: 'v' + dispatch.version,
    sourceRepository: dispatch.source_repository,
    version: dispatch.version,
  };
}

/*** Compose selected-installation fixtures with a revisioned epoch port. */
export function cohortAdapter(paths: string[]) {
  return GitHubReleaseWavePublicationCohortAdapter({
    apiBaseUrl: githubApi,
    publicationEvidencePort: {
      enrichPackageReleaseAsync: (dispatch) => Promise.resolve(eventFor(dispatch)),
    },
    publisherEpochPort: {
      loadReleaseWavePublisherEpochsAsync: ({ inventoryId }) =>
        Promise.resolve([
          {
            id: 'isolated-provider-epoch',
            inventoryId,
            publishers: [
              {
                packageName: '@ankhorage/base',
                sourceRepository: 'ankhorage/base',
                version: '1.1.0',
              },
            ],
            sourceRevision: 'e'.repeat(40),
          },
        ]),
    },
    requestAsync: (url) => {
      paths.push(String(url));
      return Promise.resolve(inventoryResponse(String(url)));
    },
    token: 'isolated-installation-token',
  });
}

/*** Serve selected-installation inventory and its immutable repository profiles. */
function inventoryResponse(url: string): Response {
  const page = new URL(url).searchParams.get('page');
  if (url.includes('/installation/repositories')) {
    const names =
      page === '1'
        ? ['base', ...Array.from({ length: 99 }, (_, index) => 'selected-' + index)]
        : ['blocked', 'nonpackage', 'private'];
    return json({
      repositories: names.map((name) => ({
        archived: false,
        default_branch: 'main',
        full_name: 'ankhorage/' + name,
      })),
    });
  }
  const repository = /repos\/ankhorage\/([^/]+)/.exec(url)?.[1];
  if (repository === undefined) return new Response(null, { status: 404 });
  if (url.includes('/git/ref/heads/'))
    return json({ object: { sha: repository + '-sha', type: 'commit' } });
  if (url.includes('renovate.yml') && repository === 'blocked') return content('unmanaged');
  if (url.includes('renovate.yml'))
    return content("github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'");
  if (repository === 'nonpackage') return new Response(null, { status: 404 });
  return url.includes('/contents/package.json')
    ? content({
        name: '@ankhorage/' + repository,
        private: repository === 'private',
        version: '1.0.0',
      })
    : new Response(null, { status: 404 });
}

/*** Provide immutable tag, workflow, registry, and provenance evidence for admission tests. */
export function publicationResponse(url: string): Response {
  if (url.startsWith(npmRegistry)) return json(publicationManifest());
  if (url.includes('/releases/tags/'))
    return json({ id: 1, tag_name: 'v1.1.0', target_commitish: 'commit' });
  if (url.includes('/git/ref/tags/')) return json({ object: { sha: 'commit', type: 'commit' } });
  return url.includes('/actions/workflows/release.yml/runs')
    ? json({ workflow_runs: [{ conclusion: 'success', head_sha: 'commit' }] })
    : new Response(null, { status: 404 });
}

export function publicationManifest() {
  return {
    dist: { integrity: integrity('base artifact') },
    gitHead: 'commit',
    name: '@ankhorage/base',
    repository: { url: 'https://github.com/ankhorage/base.git' },
    version: '1.1.0',
  };
}

export function candidateResponse(url: string): Response {
  if (url.includes('/pulls/42/reviews'))
    return json([
      { commit_id: 'stale-head', state: 'APPROVED', user: { login: 'reviewer', type: 'User' } },
    ]);
  if (url.includes('/pulls/42/files')) return json([{ filename: '.changeset/tampered.md' }]);
  return githubReleaseWaveResponseFor(
    url
      .replace(githubApi, 'https://api.github.test')
      .replace(npmRegistry, 'https://registry.npm.test'),
  );
}

export function integrity(value: string): string {
  return 'sha512-' + createHash('sha512').update(value).digest('base64');
}

function content(value: unknown): Response {
  return json({
    content: Buffer.from(JSON.stringify(value)).toString('base64'),
    encoding: 'base64',
  });
}
export function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
