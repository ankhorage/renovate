import type { PublishedPackage, ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { FencedReleaseWaveExecutionAdapter } from '../adapters/fence/FencedReleaseWaveExecutionAdapter.js';
import { acquireGitHubReleaseWaveCheckoutAsync } from '../adapters/github/acquireGitHubReleaseWaveCheckoutsAsync.js';
import { GitHubNpmReleaseWaveExecutionAdapter } from '../adapters/github/GitHubNpmReleaseWaveExecutionAdapter.js';
import { GitHubNpmReleaseWavePublicationEvidenceAdapter } from '../adapters/github/GitHubNpmReleaseWavePublicationEvidenceAdapter.js';
import { GitHubReleaseWaveCheckpointAdapter } from '../adapters/github/GitHubReleaseWaveCheckpointAdapter.js';
import { GitHubReleaseWaveEventQueueAdapter } from '../adapters/github/GitHubReleaseWaveEventQueueAdapter.js';
import {
  collectGitHubReleaseWaveInventoryAsync,
  GitHubReleaseWavePublicationCohortAdapter,
} from '../adapters/github/GitHubReleaseWavePublicationCohortAdapter.js';
import { GitHubReleaseWavePublisherEpochAdapter } from '../adapters/github/GitHubReleaseWavePublisherEpochAdapter.js';
import { runReleaseWaveRenovateAsync } from '../adapters/renovate/runReleaseWaveRenovateAsync.js';
import { runReleaseWaveCoordinatorAsync } from '../application/runReleaseWaveCoordinatorAsync.js';
import { admitVerifiedPackageReleaseEventAsync } from './admitVerifiedPackageReleaseEventAsync.js';
import { prepareReleaseWavePublisherEpochAsync } from './prepareReleaseWavePublisherEpochAsync.js';
import { releaseWaveMutationFenceFromEnvironment } from './releaseWaveMutationFenceFromEnvironment.js';

type RequestAsync = (input: string | URL, init?: RequestInit) => Promise<Response>;
interface GitHubContentInput {
  readonly owner: string;
  readonly path: string;
  readonly repo: string;
}
type GitHubContentReadInput = GitHubContentInput & { readonly ref: string };
type GitHubContentWriteInput = GitHubContentInput & {
  readonly branch: string;
  readonly content: string;
  readonly message: string;
  readonly sha?: string;
};

/*** Compose the authenticated durable release-wave coordinator from the stable publisher dispatch contract. */
export async function coordinateReleaseWaveAsync(environment: NodeJS.ProcessEnv): Promise<void> {
  const configuration = releaseWaveConfiguration(environment);
  const now = () => new Date();
  const requestAsync = (input: string | URL, init?: RequestInit) => fetch(input, init);
  const { checkpointPort, cohortInput, epochPort, publicationEvidencePort, queuePort } =
    releaseWavePorts(configuration, requestAsync);
  const inventory = await collectGitHubReleaseWaveInventoryAsync(cohortInput);
  await prepareReleaseWavePublisherEpochAsync({
    inventoryId: inventory.inventoryId,
    publisherEpochWriterPort: epochPort,
    repositories: inventory.repositories,
    token: configuration.token,
  });
  await admitVerifiedPackageReleaseEventAsync({
    maximumRetries: 4,
    packageName: configuration.packageName,
    publicationEvidencePort,
    queuePort,
    sourceRepository: configuration.sourceRepository,
    version: configuration.version,
  });
  await executeCoordinatorAsync({
    checkpointPort,
    cohortInput,
    configuration,
    fencePort: releaseWaveMutationFenceFromEnvironment(environment),
    inventory,
    now,
    queuePort,
  });
}

/*** Bind the durable state and publisher evidence adapters at the command's outer edge. */
function releaseWavePorts(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: RequestAsync,
) {
  const client = githubContentsClient(configuration, requestAsync);
  const state = {
    branch: configuration.stateBranch,
    client,
    owner: 'ankhorage',
    repository: 'renovate',
  };
  const epochPort = GitHubReleaseWavePublisherEpochAdapter({
    apiBaseUrl: configuration.apiBaseUrl,
    branch: configuration.stateBranch,
    requestAsync,
    repository: 'ankhorage/renovate',
    token: configuration.token,
  });
  const publicationEvidencePort = GitHubNpmReleaseWavePublicationEvidenceAdapter({
    apiBaseUrl: configuration.apiBaseUrl,
    npmRegistryUrl: configuration.npmRegistryUrl,
    releaseWorkflowFile: 'release.yml',
    requestAsync,
    token: configuration.token,
  });
  return {
    checkpointPort: GitHubReleaseWaveCheckpointAdapter(state),
    cohortInput: {
      apiBaseUrl: configuration.apiBaseUrl,
      publicationEvidencePort,
      publisherEpochPort: epochPort,
      requestAsync,
      token: configuration.token,
    },
    epochPort,
    publicationEvidencePort,
    queuePort: GitHubReleaseWaveEventQueueAdapter(state),
  };
}

/*** Run only after the current event and a complete immutable publisher epoch are durable. */
async function executeCoordinatorAsync(input: {
  readonly checkpointPort: ReturnType<typeof GitHubReleaseWaveCheckpointAdapter>;
  readonly cohortInput: Parameters<typeof GitHubReleaseWavePublicationCohortAdapter>[0];
  readonly configuration: ReturnType<typeof releaseWaveConfiguration>;
  readonly fencePort: ReturnType<typeof releaseWaveMutationFenceFromEnvironment>;
  readonly inventory: Awaited<ReturnType<typeof collectGitHubReleaseWaveInventoryAsync>>;
  readonly now: () => Date;
  readonly queuePort: ReturnType<typeof GitHubReleaseWaveEventQueueAdapter>;
}) {
  const repositories = new Map(
    input.inventory.repositories.map((repository) => [repository.fullName, repository]),
  );
  await runReleaseWaveCoordinatorAsync({
    checkpointPort: input.checkpointPort,
    cohortPort: GitHubReleaseWavePublicationCohortAdapter(input.cohortInput),
    executionPort: FencedReleaseWaveExecutionAdapter({
      executionPort: GitHubNpmReleaseWaveExecutionAdapter({
        apiBaseUrl: input.configuration.apiBaseUrl,
        candidateCheckoutAsync: ({ repository, revision }) =>
          candidateCheckoutAsync(repositories, repository, revision, input.configuration.token),
        npmRegistryUrl: input.configuration.npmRegistryUrl,
        owner: 'ankhorage',
        releaseWorkflowFile: 'release.yml',
        renovateAsync: (repository) =>
          runReleaseWaveRenovateAsync(repository, input.configuration.token),
        requestAsync: input.cohortInput.requestAsync,
        token: input.configuration.token,
      }),
      fencePort: input.fencePort,
      leaseId: input.configuration.mutationLeaseId,
      now: input.now,
    }),
    executorId: input.configuration.executorId,
    maximumCheckpointRetries: 4,
    maximumConcurrency: 4,
    maximumQueueRetries: 4,
    now: input.now,
    publicationPlans: new Map(),
    publishedPackages: await publishedPackagesAsync(
      input.inventory.repositories,
      input.configuration.npmRegistryUrl,
    ),
    queuePort: input.queuePort,
  });
}

/*** Acquire candidate source only when its selected immutable profile still names the exact PR head. */
async function candidateCheckoutAsync(
  repositories: ReadonlyMap<string, ReleaseWaveRepository>,
  repository: string,
  revision: string,
  token: string,
) {
  const selected = repositories.get(repository);
  if (selected === undefined)
    throw new Error('Release-wave candidate is not selected by the App installation.');
  if (selected.archived || selected.excludedReason !== undefined || !selected.bootstrapReady)
    throw new Error('Release-wave candidate is not eligible for checkout.');
  return acquireGitHubReleaseWaveCheckoutAsync({
    repository: { ...selected, sourceRevision: revision },
    token,
  });
}

/*** Query registry evidence only for active public publishers that can enter the current wave. */
async function publishedPackagesAsync(
  repositories: readonly ReleaseWaveRepository[],
  registry: string,
): Promise<readonly PublishedPackage[]> {
  return Promise.all(
    repositories.flatMap((repository) =>
      repository.archived ||
      repository.excludedReason !== undefined ||
      !repository.bootstrapReady ||
      !repository.publishable ||
      repository.private ||
      repository.packageName === undefined
        ? []
        : [publishedPackageAsync(repository.packageName, registry)],
    ),
  );
}

/*** Decode the registry's current stable version without accepting an absent or malformed dist-tag. */
async function publishedPackageAsync(name: string, registry: string): Promise<PublishedPackage> {
  const response = await fetch(registry + '/' + encodeURIComponent(name), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Release-wave registry inventory could not be verified.');
  const value = (await response.json()) as {
    readonly ['dist-tags']?: { readonly latest?: unknown };
  };
  if (typeof value['dist-tags']?.latest !== 'string')
    throw new Error('Release-wave registry latest version is invalid.');
  return { name, version: value['dist-tags'].latest };
}

/*** Adapt the narrow authenticated Contents operations required by durable ports. */
function githubContentsClient(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: RequestAsync,
) {
  return {
    repos: {
      createOrUpdateFileContents: (input: GitHubContentWriteInput) =>
        saveGithubContentAsync(configuration, requestAsync, input),
      getContent: (input: GitHubContentReadInput) =>
        loadGithubContentAsync(configuration, requestAsync, input),
    },
  };
}

/*** Write a Contents document with its observed SHA so durable ports retain CAS semantics. */
async function saveGithubContentAsync(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: RequestAsync,
  input: GitHubContentWriteInput,
) {
  const response = await requestAsync(
    configuration.apiBaseUrl +
      '/repos/' +
      input.owner +
      '/' +
      input.repo +
      '/contents/' +
      input.path,
    {
      body: JSON.stringify({
        branch: input.branch,
        content: input.content,
        message: input.message,
        ...(input.sha === undefined ? {} : { sha: input.sha }),
      }),
      headers: configuration.headers,
      method: 'PUT',
    },
  );
  if (!response.ok) throw githubError(response.status);
  return { data: (await response.json()) as { readonly content: { readonly sha: string } } };
}

/*** Load a revisioned Contents document for durable queue and checkpoint recovery. */
async function loadGithubContentAsync(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: RequestAsync,
  input: GitHubContentReadInput,
) {
  const response = await requestAsync(
    configuration.apiBaseUrl +
      '/repos/' +
      input.owner +
      '/' +
      input.repo +
      '/contents/' +
      input.path +
      '?ref=' +
      encodeURIComponent(input.ref),
    { headers: configuration.headers },
  );
  if (!response.ok) throw githubError(response.status);
  return {
    data: (await response.json()) as {
      readonly content: string;
      readonly encoding: string;
      readonly sha: string;
      readonly type: string;
    },
  };
}

/*** Preserve GitHub status so CAS adapters can classify contention deterministically. */
function githubError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error('Release-wave GitHub Contents request failed.'), { status });
}

/*** Parse the unchanged publisher event contract and fail closed for any missing activation configuration. */
function releaseWaveConfiguration(environment: NodeJS.ProcessEnv) {
  const value = {
    apiBaseUrl: environment.GITHUB_API_URL ?? 'https://api.github.com',
    executorId: environment.GITHUB_RUN_ID ?? '',
    mutationLeaseId: environment.RELEASE_WAVE_MUTATION_LEASE_ID ?? '',
    npmRegistryUrl: environment.NPM_REGISTRY_URL ?? 'https://registry.npmjs.org',
    packageName: environment.PACKAGE_NAME ?? '',
    sourceRepository: environment.SOURCE_REPOSITORY ?? '',
    stateBranch: environment.RELEASE_WAVE_STATE_BRANCH ?? '',
    token: environment.GITHUB_TOKEN ?? '',
    version: environment.PACKAGE_VERSION ?? '',
  };
  if (Object.values(value).some((entry) => entry.length === 0))
    throw new Error('Release-wave coordinator configuration is incomplete.');
  return {
    ...value,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + value.token,
      'content-type': 'application/json',
    },
  };
}
