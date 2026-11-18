import { collectGitHubReleaseWaveInventoryAsync } from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { GitHubReleaseWavePublisherEpochAdapter } from '../adapters/github/GitHubReleaseWavePublisherEpochAdapter.js';
import { GitHubReleaseWavePublisherSnapshotAckAdapter } from '../adapters/github/GitHubReleaseWavePublisherSnapshotAckAdapter.js';
import type { ReleaseWavePublisherSnapshotRequest } from '../ports/releaseWavePublisherSnapshot.js';
import { acknowledgeReleaseWavePublisherSnapshotFromCheckoutsAsync } from './acknowledgeReleaseWavePublisherSnapshotFromCheckoutsAsync.js';

/*** Compose the authenticated dispatch boundary without admitting a release event or executing the coordinator. */
export async function acknowledgeReleaseWavePublisherSnapshotFromEnvironmentAsync(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly request: ReleaseWavePublisherSnapshotRequest;
}): Promise<void> {
  const configuration = configurationFromEnvironment(input.environment);
  const requestAsync = (url: string | URL, init?: RequestInit) => fetch(url, init);
  const epochPort = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: configuration.apiBaseUrl,
    branch: configuration.stateBranch,
    requestAsync,
    repository: 'ankhorage/renovate',
    token: configuration.token,
  });
  const cohortInput = {
    apiBaseUrl: configuration.apiBaseUrl,
    publicationEvidencePort: {
      enrichPackageReleaseAsync: async () => {
        throw new Error('Snapshot composition does not load post-publish evidence.');
      },
    },
    publisherEpochPort: epochPort,
    requestAsync,
    token: configuration.token,
  };
  const inventory = await collectGitHubReleaseWaveInventoryAsync(cohortInput);
  const ack = await acknowledgeReleaseWavePublisherSnapshotFromCheckoutsAsync({
    ackPort: GitHubReleaseWavePublisherSnapshotAckAdapter(
      contentsInput(configuration, requestAsync),
    ),
    inventoryId: inventory.inventoryId,
    publisherEpochWriterPort: epochPort,
    repositories: inventory.repositories,
    request: input.request,
    token: configuration.token,
  });
  process.stdout.write(JSON.stringify(ack) + '\n');
}

/*** Read only the state required by the pre-publish dispatch, failing closed before provider work. */
function configurationFromEnvironment(environment: NodeJS.ProcessEnv) {
  const configuration = {
    apiBaseUrl: environment.GITHUB_API_URL ?? 'https://api.github.com',
    stateBranch: environment.RELEASE_WAVE_STATE_BRANCH ?? '',
    token: environment.GITHUB_TOKEN ?? '',
  };
  if (!configuration.stateBranch || !configuration.token)
    throw new Error('Release-wave publisher snapshot configuration is incomplete.');
  return configuration;
}

/*** Adapt the narrow state-file capability required by the ACK port at the composition edge. */
function contentsInput(
  configuration: ReturnType<typeof configurationFromEnvironment>,
  requestAsync: (url: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const request = async (path: string, init: RequestInit) => {
    const response = await requestAsync(configuration.apiBaseUrl + path, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + configuration.token,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (response.ok) return response;
    throw Object.assign(new Error('Release-wave snapshot GitHub Contents request failed.'), {
      status: response.status,
    });
  };
  return {
    branch: configuration.stateBranch,
    client: {
      repos: {
        createOrUpdateFileContents: async (input: {
          readonly branch: string;
          readonly content: string;
          readonly message: string;
          readonly owner: string;
          readonly path: string;
          readonly repo: string;
          readonly sha?: string;
        }) => ({
          data: (await request(
            '/repos/' + input.owner + '/' + input.repo + '/contents/' + input.path,
            {
              body: JSON.stringify({
                branch: input.branch,
                content: input.content,
                message: input.message,
                ...(input.sha === undefined ? {} : { sha: input.sha }),
              }),
              method: 'PUT',
            },
          ).then(async (response) => await response.json())) as {
            readonly content: { readonly sha: string };
          },
        }),
        getContent: async (input: {
          readonly owner: string;
          readonly path: string;
          readonly ref: string;
          readonly repo: string;
        }) => ({
          data: (await request(
            '/repos/' +
              input.owner +
              '/' +
              input.repo +
              '/contents/' +
              input.path +
              '?ref=' +
              encodeURIComponent(input.ref),
            { method: 'GET' },
          ).then(async (response) => await response.json())) as {
            readonly content: string;
            readonly encoding: string;
            readonly sha: string;
            readonly type: string;
          },
        }),
      },
    },
    owner: 'ankhorage',
    repository: 'renovate',
  };
}
