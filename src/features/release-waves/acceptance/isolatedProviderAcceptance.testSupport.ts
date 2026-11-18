import { createHash } from 'node:crypto';

import { GitHubReleaseWavePublicationCohortAdapter } from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { githubReleaseWaveResponseFor } from '../adapters/github/githubReleaseWaveResponse.testSupport.js';
import type { acknowledgeReleaseWavePublisherSnapshotAsync } from '../application/acknowledgeReleaseWavePublisherSnapshotAsync.js';
import type { ReleaseWavePublisherSnapshotAck } from '../ports/releaseWavePublisherSnapshot.js';

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
      loadReleaseWavePublisherEpochsAsync: () =>
        Promise.resolve([
          {
            id: 'isolated-provider-epoch',
            inventoryId: 'a'.repeat(64),
            publishers: [
              {
                packageName: '@ankhorage/base',
                planRevision: 'a'.repeat(40),
                planStatusHash: 'b'.repeat(64),
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
        version: repository === 'base' ? '1.1.0' : '1.0.0',
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

/** Create durable ACK state whose first provider response is lost after persistence. */
export function lostAckSnapshotInput() {
  const request = {
    changesetsStatusHash: 'c'.repeat(64),
    requestId: 'provider-snapshot-request-0001',
    sourceRepository: 'ankhorage/base',
    sourceSha: 'b'.repeat(40),
  };
  const persistence = lostAckPersistence();
  return { epochs: persistence.epochs, input: snapshotInput(request, persistence), request };
}

/** Retain the independently durable ACK and epoch writer across a simulated process restart. */
function lostAckPersistence() {
  const acknowledgements = new Map<string, ReleaseWavePublisherSnapshotAck>();
  let epochCount = 0;
  let loseResponse = true;
  return {
    ackPort: {
      loadReleaseWavePublisherSnapshotAckAsync: (requestId: string) =>
        Promise.resolve(acknowledgements.get(requestId)),
      saveReleaseWavePublisherSnapshotAckAsync: (ack: ReleaseWavePublisherSnapshotAck) => {
        acknowledgements.set(ack.requestId, ack);
        if (loseResponse) {
          loseResponse = false;
          return Promise.reject(new Error('simulated lost ACK response'));
        }
        return Promise.resolve(ack);
      },
    },
    epochs: () => epochCount,
    publisherEpochWriterPort: {
      adoptReleaseWavePublisherEpochAsync: () => {
        epochCount += 1;
        return Promise.resolve({
          id: 'd'.repeat(64),
          inventoryId: 'a'.repeat(64),
          publishers: [],
          sourceRevision: 'e'.repeat(40),
        });
      },
    },
  };
}

/** Bind the durable ACK fixture to one selected immutable publisher and complete decision. */
function snapshotInput(
  request: {
    readonly changesetsStatusHash: string;
    readonly requestId: string;
    readonly sourceRepository: string;
    readonly sourceSha: string;
  },
  persistence: ReturnType<typeof lostAckPersistence>,
) {
  return {
    ackPort: persistence.ackPort,
    inventoryId: 'a'.repeat(64),
    publicationDecisions: snapshotDecisions(request),
    publisherEpochWriterPort: persistence.publisherEpochWriterPort,
    repositories: [snapshotRepository(request)],
    request,
  } satisfies Parameters<typeof acknowledgeReleaseWavePublisherSnapshotAsync>[0];
}

/** Supply the only complete patch decision which can enter the epoch. */
function snapshotDecisions(request: {
  readonly changesetsStatusHash: string;
  readonly sourceRepository: string;
  readonly sourceSha: string;
}) {
  return new Map([
    [
      request.sourceRepository,
      {
        releasePlan: {
          packageName: '@ankhorage/base',
          releases: [{ packageName: '@ankhorage/base', type: 'patch' as const }],
          revision: request.sourceSha,
          statusHash: request.changesetsStatusHash,
          version: '1.0.1',
        },
        revision: request.sourceSha,
        statusHash: request.changesetsStatusHash,
      },
    ],
  ]);
}

/** Keep source SHA validation bound to the selected repository profile. */
function snapshotRepository(request: {
  readonly sourceRepository: string;
  readonly sourceSha: string;
}) {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: request.sourceRepository,
    packageName: '@ankhorage/base',
    packageVersion: '1.0.0',
    private: false,
    publishable: true,
    sourceRevision: request.sourceSha,
  };
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
