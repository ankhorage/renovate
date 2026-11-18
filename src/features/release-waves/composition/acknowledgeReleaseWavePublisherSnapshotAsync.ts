import { collectGitHubReleaseWaveInventoryAsync } from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { GitHubReleaseWavePublisherEpochAdapter } from '../adapters/github/GitHubReleaseWavePublisherEpochAdapter.js';
import { GitHubReleaseWavePublisherSnapshotAckAdapter } from '../adapters/github/GitHubReleaseWavePublisherSnapshotAckAdapter.js';
import { githubReleaseWaveSnapshotContentsClient } from '../adapters/github/githubReleaseWaveSnapshotContentsClient.js';
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
      enrichPackageReleaseAsync: () =>
        Promise.reject(new Error('Snapshot composition does not load post-publish evidence.')),
    },
    publisherEpochPort: epochPort,
    requestAsync,
    token: configuration.token,
  };
  const inventory = await collectGitHubReleaseWaveInventoryAsync(cohortInput);
  const ack = await acknowledgeReleaseWavePublisherSnapshotFromCheckoutsAsync({
    ackPort: GitHubReleaseWavePublisherSnapshotAckAdapter(
      githubReleaseWaveSnapshotContentsClient(configuration, requestAsync),
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
