import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';
import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
import type {
  ReleaseWavePublicationCohort,
  ReleaseWavePublicationCohortPort,
  SettledReleaseWavePublication,
} from '../../ports/releaseWavePublicationCohort.js';
import type { ReleaseWavePublicationEvidencePort } from '../../ports/releaseWavePublicationEvidence.js';
import type { ReleaseWavePublisherEpochPort } from '../../ports/releaseWavePublisherEpoch.js';
import { githubReleaseWaveConfiguration } from './githubReleaseWaveConfiguration.js';
import { githubReleaseWaveEmptyDependencies } from './githubReleaseWaveEmptyDependencies.js';
import { githubReleaseWavePublisherEpochAsync } from './githubReleaseWavePublisherEpoch.js';
import { githubReleaseWaveSnapshotId } from './githubReleaseWaveSnapshotId.js';

export interface GitHubReleaseWavePublicationCohortAdapterInput {
  readonly apiBaseUrl: string;
  readonly publicationEvidencePort: ReleaseWavePublicationEvidencePort;
  /** Authenticated durable release-plan source; it is intentionally independent from webhook arrival order. */
  readonly publisherEpochPort: ReleaseWavePublisherEpochPort;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly token: string;
}

/*** Collect an immutable, selected-installation publisher cohort without trusting caller inventory. */
export function GitHubReleaseWavePublicationCohortAdapter(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
): ReleaseWavePublicationCohortPort {
  githubReleaseWaveConfiguration(input);
  return {
    collectReleaseWavePublicationCohortAsync: (request) =>
      collectReleaseWavePublicationCohortAsync(input, request.pendingEvents),
  };
}

/*** Resolve the selected App inventory, graph closure, and exact publisher proofs as one snapshot. */
async function collectReleaseWavePublicationCohortAsync(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  pendingEvents: Parameters<
    ReleaseWavePublicationCohortPort['collectReleaseWavePublicationCohortAsync']
  >[0]['pendingEvents'],
): Promise<ReleaseWavePublicationCohort | undefined> {
  if (pendingEvents.length === 0) return undefined;
  const { inventoryId, repositories } = await collectGitHubReleaseWaveInventoryAsync(input);
  const byPackage = uniqueRepositoriesByPackage(repositories);
  const scheduled = await githubReleaseWavePublisherEpochAsync({
    inventoryId,
    pendingEvents,
    publisherEpochPort: input.publisherEpochPort,
    repositories,
  });
  if (scheduled === undefined) return undefined;
  const publications = await Promise.all(
    scheduled.events.map((event) =>
      settledPublicationAsync(input, event, byPackage.get(event.packageName)),
    ),
  );
  if (publications.some((publication) => publication === undefined)) return undefined;
  return {
    epoch: scheduled.epoch,
    publications: publications.filter(isPublication),
    repositories,
  };
}

/*** Collect one complete authenticated installation snapshot for epoch admission and execution. */
export async function collectGitHubReleaseWaveInventoryAsync(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
): Promise<{
  readonly inventoryId: string;
  readonly repositories: readonly ReleaseWaveRepository[];
}> {
  const repositories = await selectedRepositoriesAsync(input);
  if (repositories.length === 0) throw new Error('Selected installation inventory is empty.');
  return { inventoryId: githubReleaseWaveSnapshotId(repositories), repositories };
}

/*** Load every repository visible to the installation, rejecting incomplete pagination. */
async function selectedRepositoriesAsync(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
): Promise<readonly ReleaseWaveRepository[]> {
  const installation = await pagesAsync<GitHubInstallationRepository>(
    input,
    '/installation/repositories',
  );
  const selected = installation
    .filter((repository) => repository.full_name?.startsWith('ankhorage/') === true)
    .sort((left, right) => (left.full_name ?? '').localeCompare(right.full_name ?? ''));
  return Promise.all(selected.map((repository) => repositoryProfileAsync(input, repository)));
}

/*** Derive one immutable repository profile from content pinned to its resolved default-branch commit. */
async function repositoryProfileAsync(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  repository: GitHubInstallationRepository,
): Promise<ReleaseWaveRepository> {
  if (!repository.full_name || !repository.default_branch)
    throw new Error('Selected installation repository metadata is incomplete.');
  const reference = await jsonAsync<GitHubReference>(
    input,
    '/repos/' +
      repository.full_name +
      '/git/ref/heads/' +
      encodeURIComponent(repository.default_branch),
  );
  const revision = reference.object?.type === 'commit' ? reference.object.sha : undefined;
  if (!revision)
    throw new Error('Selected installation repository default branch is not immutable.');
  const manifestSource = await optionalContentAsync<string>(
    input,
    repository.full_name,
    'package.json',
    revision,
  );
  const workflow = await optionalContentAsync<string>(
    input,
    repository.full_name,
    '.github/workflows/renovate.yml',
    revision,
  );
  return profileFromManifest(
    repository,
    manifestSource === undefined ? undefined : parsePackageManifest(manifestSource),
    workflow,
    revision,
  );
}

/*** Decode package metadata only after the immutable source response has been authenticated. */
function parsePackageManifest(source: string): PackageManifest {
  const value = JSON.parse(source) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Selected installation package manifest is malformed.');
  return value;
}

/*** Re-verify each queued event with the App-token-backed evidence boundary and source identity. */
async function settledPublicationAsync(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  event: Parameters<
    ReleaseWavePublicationCohortPort['collectReleaseWavePublicationCohortAsync']
  >[0]['pendingEvents'][number],
  repository: ReleaseWaveRepository | undefined,
): Promise<SettledReleaseWavePublication | undefined> {
  if (
    repository?.fullName !== event.sourceRepository ||
    repository.packageName !== event.packageName
  )
    return undefined;
  const verified = await input.publicationEvidencePort.enrichPackageReleaseAsync({
    package_name: event.packageName,
    source_repository: event.sourceRepository,
    version: event.version,
  });
  if (releaseWaveEventIdentity(verified) !== event.eventId) return undefined;
  return { ...verified, name: verified.packageName };
}

/*** Decode a manifest into the narrow release-wave profile without carrying provider response shapes inward. */
function profileFromManifest(
  repository: GitHubInstallationRepository,
  manifest: PackageManifest | undefined,
  workflow: string | undefined,
  sourceRevision: string,
): ReleaseWaveRepository {
  const { full_name: fullName } = repository;
  if (!fullName) throw new Error('Selected installation repository name is incomplete.');
  if (manifest === undefined)
    return {
      archived: repository.archived === true,
      bootstrapReady: false,
      dependencies: githubReleaseWaveEmptyDependencies(),
      excludedReason: 'missing package.json',
      fullName,
      private: true,
      publishable: false,
      sourceRevision,
    };
  const packageName = typeof manifest.name === 'string' ? manifest.name : undefined;
  const packageVersion = typeof manifest.version === 'string' ? manifest.version : undefined;
  const privatePackage = manifest.private === true;
  return {
    archived: repository.archived === true,
    bootstrapReady:
      workflow?.includes(
        "github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'",
      ) === true,
    dependencies: dependencySections(manifest),
    fullName,
    packageName,
    packageVersion,
    private: privatePackage,
    publishable: !privatePackage && packageName !== undefined && packageVersion !== undefined,
    sourceRevision,
  };
}

/*** Preserve only declared dependency maps, treating malformed manifest fields as empty rather than trusted. */
function dependencySections(manifest: PackageManifest): ReleaseWaveRepository['dependencies'] {
  return {
    dependencies: dependencyRecord(manifest.dependencies, 'dependencies'),
    devDependencies: dependencyRecord(manifest.devDependencies, 'devDependencies'),
    optionalDependencies: dependencyRecord(manifest.optionalDependencies, 'optionalDependencies'),
    peerDependencies: dependencyRecord(manifest.peerDependencies, 'peerDependencies'),
  };
}

/*** Reject duplicate selected package identities because no source identity can then be authoritative. */
function uniqueRepositoriesByPackage(
  repositories: readonly ReleaseWaveRepository[],
): ReadonlyMap<string, ReleaseWaveRepository> {
  const entries = repositories.flatMap((repository) =>
    repository.packageName === undefined ? [] : [[repository.packageName, repository] as const],
  );
  const names = entries.map(([name]) => name);
  if (new Set(names).size !== names.length)
    throw new Error('Selected installation contains duplicate package identities.');
  return new Map(entries);
}

/*** Read all terminal pages with an explicit finite bound rather than treating a truncated provider feed as complete. */
async function pagesAsync<T>(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  path: string,
): Promise<readonly T[]> {
  const values: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const envelope = await jsonAsync<{ readonly repositories?: readonly T[] }>(
      input,
      path + '?per_page=100&page=' + page,
    );
    const entries = envelope.repositories;
    if (entries === undefined)
      throw new Error('Selected installation pagination response is malformed.');
    values.push(...entries);
    if (entries.length < 100) return values;
  }
  throw new Error('Selected installation pagination is incomplete.');
}

/*** Read optional bootstrap policy while allowing a selected repository to remain pending bootstrap. */
async function optionalContentAsync<T>(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  repository: string,
  path: string,
  revision: string,
): Promise<T | undefined> {
  const response = await input.requestAsync(
    input.apiBaseUrl +
      '/repos/' +
      repository +
      '/contents/' +
      path +
      '?ref=' +
      encodeURIComponent(revision),
    { headers: headers(input) },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('Selected installation content could not be verified.');
  const content = (await response.json()) as {
    readonly content?: string;
    readonly encoding?: string;
  };
  if (content.encoding !== 'base64' || !content.content)
    throw new Error('Selected installation content is not a readable base64 file.');
  return Buffer.from(content.content, 'base64').toString('utf8') as T;
}

/*** Request and decode one authenticated provider response. */
async function jsonAsync<T>(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  path: string,
): Promise<T> {
  const response = await input.requestAsync(input.apiBaseUrl + path, { headers: headers(input) });
  if (!response.ok) throw new Error('Selected installation evidence could not be verified.');
  return response.json() as Promise<T>;
}

/*** Keep the GitHub App installation token at the only provider boundary. */
function headers(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
): Readonly<Record<string, string>> {
  return { accept: 'application/vnd.github+json', authorization: 'Bearer ' + input.token };
}

/*** Narrow untrusted JSON to a dependency record containing only string declarations. */
function dependencyRecord(value: unknown, section: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Selected installation manifest has malformed ' + section + '.');
  if (Object.values(value).some((entry) => typeof entry !== 'string'))
    throw new Error('Selected installation manifest has malformed ' + section + '.');
  return value as Readonly<Record<string, string>>;
}

interface GitHubInstallationRepository {
  readonly archived?: boolean;
  readonly default_branch?: string;
  readonly full_name?: string;
}
interface GitHubReference {
  readonly object?: { readonly sha?: string; readonly type?: string };
}
interface PackageManifest {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly name?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly private?: unknown;
  readonly version?: unknown;
}

function isPublication(
  value: SettledReleaseWavePublication | undefined,
): value is SettledReleaseWavePublication {
  return value !== undefined;
}
