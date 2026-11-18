import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWaveExecutionAdapter } from '../adapters/github/GitHubNpmReleaseWaveExecutionAdapter.js';
import { GitHubNpmReleaseWavePublicationEvidenceAdapter } from '../adapters/github/GitHubNpmReleaseWavePublicationEvidenceAdapter.js';
import { GitHubReleaseWavePublicationCohortAdapter } from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { githubReleaseWaveResponseFor } from '../adapters/github/githubReleaseWaveResponse.testSupport.js';
import { ingestReleaseWaveEventAsync } from '../application/ingestReleaseWaveEventAsync.js';
import { runReleaseWaveCoordinatorAsync } from '../application/runReleaseWaveCoordinatorAsync.js';
import {
  coordinatorInput,
  event,
  eventQueue,
} from '../application/test-support/releaseWaveFixtures.js';
import { releaseWaveEventIdentity } from '../domain/releaseWaveEventIdentity.js';

const githubApi = 'https://api.github.provider-contract.test';
const npmRegistry = 'https://registry.npm.provider-contract.test';

test('accepts every paginated selected repository, including private and nonpackage profiles', async () => {
  const paths: string[] = [];
  const adapter = GitHubReleaseWavePublicationCohortAdapter({
    apiBaseUrl: githubApi,
    publicationEvidencePort: {
      enrichPackageReleaseAsync: (dispatch) => Promise.resolve(eventFor(dispatch)),
    },
    publisherEpochsAsync: ({ inventoryId }) =>
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
        },
      ]),
    requestAsync: (url) => {
      paths.push(String(url));
      return Promise.resolve(inventoryResponse(String(url)));
    },
    token: 'isolated-installation-token',
  });

  const base = eventFor({
    package_name: '@ankhorage/base',
    source_repository: 'ankhorage/base',
    version: '1.1.0',
  });
  const cohort = await adapter.collectReleaseWavePublicationCohortAsync({
    pendingEvents: [{ ...base, eventId: releaseWaveEventIdentity(base) }],
  });

  expect(paths).toContain(githubApi + '/installation/repositories?per_page=100&page=1');
  expect(paths).toContain(githubApi + '/installation/repositories?per_page=100&page=2');
  expect(cohort?.repositories).toHaveLength(103);
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/private'),
  ).toMatchObject({ private: true, publishable: false });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/nonpackage'),
  ).toMatchObject({ excludedReason: 'missing package.json', publishable: false });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/blocked'),
  ).toMatchObject({ bootstrapReady: false });
});

test('requires tag, named release workflow, npm gitHead, and tarball integrity before event admission', async () => {
  const evidence = GitHubNpmReleaseWavePublicationEvidenceAdapter({
    apiBaseUrl: githubApi,
    npmRegistryUrl: npmRegistry,
    releaseWorkflowFile: 'release.yml',
    requestAsync: (url) => Promise.resolve(publicationResponse(String(url))),
    token: 'isolated-installation-token',
  });

  const publication = await evidence.enrichPackageReleaseAsync({
    package_name: '@ankhorage/base',
    source_repository: 'ankhorage/base',
    version: '1.1.0',
  });
  expect(publication).toMatchObject({
    npmArtifactIntegrity: integrity('base artifact'),
    releaseTag: 'v1.1.0',
  });

  const wrongSource = GitHubNpmReleaseWavePublicationEvidenceAdapter({
    apiBaseUrl: githubApi,
    npmRegistryUrl: npmRegistry,
    releaseWorkflowFile: 'release.yml',
    requestAsync: (url) =>
      Promise.resolve(
        String(url).startsWith(npmRegistry)
          ? json({
              ...publicationManifest(),
              repository: { url: 'https://github.com/ankhorage/other.git' },
            })
          : publicationResponse(String(url)),
      ),
    token: 'isolated-installation-token',
  });
  const error = await wrongSource
    .enrichPackageReleaseAsync({
      package_name: '@ankhorage/base',
      source_repository: 'ankhorage/base',
      version: '1.1.0',
    })
    .then(
      () => undefined,
      (reason: unknown) => reason,
    );
  expect(error).toBeInstanceOf(Error);
});

test('settles delayed diamond publishers once across reordered dispatch, restart, and queue CAS conflict', async () => {
  const queue = eventQueue([1, 4]);
  const calls: string[] = [];
  const input = coordinatorInput(queue, calls);
  for (const publisher of [
    event('left', '1.1.0'),
    event('base', '1.1.0'),
    event('base', '1.1.0'),
  ]) {
    await ingestReleaseWaveEventAsync({ event: publisher, maximumRetries: 3, queuePort: queue });
  }

  const first = await runReleaseWaveCoordinatorAsync(input);
  const restarted = await runReleaseWaveCoordinatorAsync(input);

  expect(first?.waves).toEqual([['ankhorage/consumer']]);
  expect(restarted).toBeUndefined();
  expect(calls.filter((call) => call === 'ensure:ankhorage/consumer')).toHaveLength(1);
  expect((await queue.loadReleaseWaveEventQueueAsync())?.queue.events).toEqual([]);
});

test('blocks a stale protected candidate approval and tampered Changeset evidence', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: githubApi,
    npmRegistryUrl: npmRegistry,
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url) => Promise.resolve(candidateResponse(String(url))),
    token: 'isolated-installation-token',
  });
  const verification = await adapter.verifyReleaseWaveRepositoryAsync({
    node: {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: { version: '1.2.4' },
      packageName: '@ankhorage/example',
      repository: 'ankhorage/example',
      requiresNpmPublication: true,
    },
    runId: 'isolated-provider-run',
  });

  expect(verification.requiredReviewsApproved).toBe(false);
  expect(verification.lockfileUpdated).toBe(false);
});

test('blocks a partial npm publication even after otherwise complete GitHub evidence', async () => {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: githubApi,
    npmRegistryUrl: npmRegistry,
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url) =>
      Promise.resolve(
        String(url) === npmRegistry + '/%40ankhorage%2Fexample'
          ? json({
              'dist-tags': { latest: '1.2.3' },
              versions: {
                '1.2.3': {
                  dist: { integrity: integrity('old'), tarball: npmRegistry + '/old.tgz' },
                },
              },
            })
          : candidateResponse(String(url)),
      ),
    token: 'isolated-installation-token',
  });
  const verification = await adapter.verifyReleaseWaveRepositoryAsync({
    node: {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: { version: '1.2.4' },
      packageName: '@ankhorage/example',
      repository: 'ankhorage/example',
      requiresNpmPublication: true,
    },
    runId: 'isolated-provider-run',
  });

  expect(verification.npmArtifactVerified).toBe(false);
  expect(verification.npmVersionVerified).toBe(false);
});

test('keeps the legacy dispatch workflow excluded from the inactive coordinator path', () => {
  const workflow = readFileSync(
    new URL('../../../../.github/workflows/rollout-package-release.yml', import.meta.url),
    'utf8',
  );

  expect(workflow).toContain('group: coordinated-release-wave');
  expect(workflow).not.toContain('runReleaseWaveCoordinatorAsync');
  expect(workflow).not.toContain('release-wave-checkpoints');
});

function eventFor(dispatch: {
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

function inventoryResponse(url: string): Response {
  const page = new URL(url).searchParams.get('page');
  if (url.includes('/installation/repositories')) {
    const names =
      page === '1'
        ? ['base', ...Array.from({ length: 99 }, (_, index) => 'selected-' + index)]
        : ['blocked', 'nonpackage', 'private'];
    return json({ repositories: names.map(inventoryRepository) });
  }
  const repository = /repos\/ankhorage\/([^/]+)/.exec(url)?.[1];
  if (repository === undefined) return new Response(null, { status: 404 });
  if (url.includes('/git/ref/heads/'))
    return json({ object: { sha: repository + '-sha', type: 'commit' } });
  if (url.includes('renovate.yml') && repository === 'blocked') return content('unmanaged');
  if (url.includes('renovate.yml'))
    return content("github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'");
  if (repository === 'nonpackage') return new Response(null, { status: 404 });
  if (url.includes('/contents/package.json'))
    return content({
      name: '@ankhorage/' + repository,
      private: repository === 'private',
      version: '1.0.0',
    });
  return new Response(null, { status: 404 });
}

function inventoryRepository(name: string) {
  return { archived: false, default_branch: 'main', full_name: 'ankhorage/' + name };
}

function publicationResponse(url: string): Response {
  if (url.startsWith(npmRegistry)) return json(publicationManifest());
  if (url.includes('/releases/tags/'))
    return json({ id: 1, tag_name: 'v1.1.0', target_commitish: 'commit' });
  if (url.includes('/git/ref/tags/')) return json({ object: { sha: 'commit', type: 'commit' } });
  if (url.includes('/actions/workflows/release.yml/runs'))
    return json({ workflow_runs: [{ conclusion: 'success', head_sha: 'commit' }] });
  return new Response(null, { status: 404 });
}

function publicationManifest() {
  return {
    dist: { integrity: integrity('base artifact') },
    gitHead: 'commit',
    name: '@ankhorage/base',
    repository: { url: 'https://github.com/ankhorage/base.git' },
    version: '1.1.0',
  };
}

function candidateResponse(url: string): Response {
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

function integrity(value: string): string {
  return 'sha512-' + createHash('sha512').update(value).digest('base64');
}

function content(value: unknown): Response {
  return json({
    content: Buffer.from(JSON.stringify(value)).toString('base64'),
    encoding: 'base64',
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
