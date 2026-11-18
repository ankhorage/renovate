import type { PublishedPackage, ReleaseWaveRepository } from '../../../types/releaseWave.js';
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
import { ingestPackageReleaseEventAsync } from '../application/ingestPackageReleaseEventAsync.js';
import { runReleaseWaveCoordinatorAsync } from '../application/runReleaseWaveCoordinatorAsync.js';
import { prepareReleaseWavePublisherEpochAsync } from './prepareReleaseWavePublisherEpochAsync.js';

/*** Compose the authenticated durable release-wave coordinator from the stable publisher dispatch contract. */
export async function coordinateReleaseWaveAsync(environment: NodeJS.ProcessEnv): Promise<void> {
  const configuration = releaseWaveConfiguration(environment);
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
  await ingestPackageReleaseEventAsync({
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
    inventory,
    queuePort,
  });
}

/*** Bind the durable state and publisher evidence adapters at the command's outer edge. */
function releaseWavePorts(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>,
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
  readonly inventory: Awaited<ReturnType<typeof collectGitHubReleaseWaveInventoryAsync>>;
  readonly queuePort: ReturnType<typeof GitHubReleaseWaveEventQueueAdapter>;
}) {
  const repositories = new Map(
    input.inventory.repositories.map((repository) => [repository.fullName, repository]),
  );
  await runReleaseWaveCoordinatorAsync({
    checkpointPort: input.checkpointPort,
    cohortPort: GitHubReleaseWavePublicationCohortAdapter(input.cohortInput),
    executionPort: GitHubNpmReleaseWaveExecutionAdapter({
      apiBaseUrl: input.configuration.apiBaseUrl,
      candidateCheckoutAsync: ({ repository, revision }) =>
        candidateCheckoutAsync(repositories, repository, revision, input.configuration.token),
      npmRegistryUrl: input.configuration.npmRegistryUrl,
      owner: 'ankhorage',
      releaseWorkflowFile: 'release.yml',
      renovateAsync: (repository) => renovateAsync(repository, input.configuration),
      requestAsync: input.cohortInput.requestAsync,
      token: input.configuration.token,
    }),
    executorId: input.configuration.executorId,
    maximumCheckpointRetries: 4,
    maximumConcurrency: 4,
    maximumQueueRetries: 4,
    now: () => new Date(),
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
  return acquireGitHubReleaseWaveCheckoutAsync({
    repository: { ...selected, sourceRevision: revision },
    token,
  });
}

/*** Query every selected public package registry manifest; incomplete provider data blocks execution. */
async function publishedPackagesAsync(
  repositories: readonly ReleaseWaveRepository[],
  registry: string,
): Promise<readonly PublishedPackage[]> {
  return Promise.all(
    repositories.flatMap((repository) =>
      repository.packageName === undefined || repository.private
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

/*** Run Renovate only through the fenced execution adapter and one selected repository. */
async function renovateAsync(
  repository: string,
  configuration: ReturnType<typeof releaseWaveConfiguration>,
): Promise<void> {
  const subprocess = Bun.spawn(['bun', 'x', 'renovate'], {
    env: {
      ...process.env,
      RENOVATE_AUTODISCOVER: 'false',
      RENOVATE_ONBOARDING: 'false',
      RENOVATE_PLATFORM: 'github',
      RENOVATE_REPOSITORIES: repository,
      RENOVATE_REQUIRE_CONFIG: 'required',
      RENOVATE_TOKEN: configuration.token,
    },
    stderr: 'pipe',
    stdout: 'inherit',
  });
  if ((await subprocess.exited) !== 0)
    throw new Error(
      'Release-wave Renovate execution failed: ' + (await new Response(subprocess.stderr).text()),
    );
}

/*** Adapt the narrow authenticated Contents operations required by durable ports. */
function githubContentsClient(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>,
) {
  return {
    repos: {
      createOrUpdateFileContents: (input: {
        readonly branch: string;
        readonly content: string;
        readonly message: string;
        readonly owner: string;
        readonly path: string;
        readonly repo: string;
        readonly sha?: string;
      }) => saveGithubContentAsync(configuration, requestAsync, input),
      getContent: (input: {
        readonly owner: string;
        readonly path: string;
        readonly ref: string;
        readonly repo: string;
      }) => loadGithubContentAsync(configuration, requestAsync, input),
    },
  };
}

/*** Write a Contents document with its observed SHA so durable ports retain CAS semantics. */
async function saveGithubContentAsync(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: {
    readonly branch: string;
    readonly content: string;
    readonly message: string;
    readonly owner: string;
    readonly path: string;
    readonly repo: string;
    readonly sha?: string;
  },
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
      headers: githubHeaders(configuration),
      method: 'PUT',
    },
  );
  if (!response.ok) throw githubError(response.status);
  return { data: (await response.json()) as { readonly content: { readonly sha: string } } };
}

/*** Load a revisioned Contents document for durable queue and checkpoint recovery. */
async function loadGithubContentAsync(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
  requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>,
  input: {
    readonly owner: string;
    readonly path: string;
    readonly ref: string;
    readonly repo: string;
  },
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
    { headers: githubHeaders(configuration) },
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

/*** Keep authentication at the one outer provider boundary. */
function githubHeaders(
  configuration: ReturnType<typeof releaseWaveConfiguration>,
): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + configuration.token,
    'content-type': 'application/json',
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
    npmRegistryUrl: environment.NPM_REGISTRY_URL ?? 'https://registry.npmjs.org',
    packageName: environment.PACKAGE_NAME ?? '',
    sourceRepository: environment.SOURCE_REPOSITORY ?? '',
    stateBranch: environment.RELEASE_WAVE_STATE_BRANCH ?? '',
    token: environment.GITHUB_TOKEN ?? '',
    version: environment.PACKAGE_VERSION ?? '',
  };
  if (Object.values(value).some((entry) => entry.length === 0))
    throw new Error('Release-wave coordinator configuration is incomplete.');
  return value;
}
