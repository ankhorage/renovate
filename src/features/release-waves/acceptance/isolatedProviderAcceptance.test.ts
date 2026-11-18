import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWaveExecutionAdapter } from '../adapters/github/GitHubNpmReleaseWaveExecutionAdapter.js';
import { GitHubNpmReleaseWavePublicationEvidenceAdapter } from '../adapters/github/GitHubNpmReleaseWavePublicationEvidenceAdapter.js';
import { ingestReleaseWaveEventAsync } from '../application/ingestReleaseWaveEventAsync.js';
import { runReleaseWaveCoordinatorAsync } from '../application/runReleaseWaveCoordinatorAsync.js';
import {
  coordinatorInput,
  event,
  eventQueue,
} from '../application/test-support/releaseWaveFixtures.js';
import { releaseWaveEventIdentity } from '../domain/releaseWaveEventIdentity.js';
import {
  candidatePublication,
  candidateResponse,
  cohortAdapter,
  eventFor,
  githubApi,
  integrity,
  json,
  npmRegistry,
  publicationManifest,
  publicationResponse,
} from './isolatedProviderAcceptance.testSupport.js';

test('accepts every paginated selected repository from authenticated epoch-plan evidence', async () => {
  const paths: string[] = [];
  const adapter = cohortAdapter(paths);

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
    candidatePublication,
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
    candidatePublication,
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

test('requires durable mutation-fence admission for legacy and coordinator workflow mutations', () => {
  const rolloutWorkflow = readFileSync(
    new URL('../../../../.github/workflows/rollout-package-release.yml', import.meta.url),
    'utf8',
  );
  const reconcileWorkflow = readFileSync(
    new URL('../../../../.github/workflows/reconcile.yml', import.meta.url),
    'utf8',
  );

  expect(rolloutWorkflow).toContain('fence.ts acquire legacy');
  expect(rolloutWorkflow).toContain('fence.ts acquire coordinator');
  expect(rolloutWorkflow).toContain('RELEASE_WAVE_MUTATION_LEASE_ID');
  expect(rolloutWorkflow).toContain('release/coordinate.ts');
  expect(reconcileWorkflow).toContain('fence.ts acquire legacy');
  expect(reconcileWorkflow).toContain('RELEASE_WAVE_MUTATION_LEASE_ID');
});
