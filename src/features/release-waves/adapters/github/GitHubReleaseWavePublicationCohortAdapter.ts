import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';
import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
import type {
  ReleaseWavePublicationCohort,
  ReleaseWavePublicationCohortPort,
  SettledReleaseWavePublication,
} from '../../ports/releaseWavePublicationCohort.js';
import type { ReleaseWavePublicationEvidencePort } from '../../ports/releaseWavePublicationEvidence.js';

interface GitHubReleaseWavePublicationCohortAdapterInput {
  readonly apiBaseUrl: string;
  readonly publicationEvidencePort: ReleaseWavePublicationEvidencePort;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly token: string;
}

/*** Collect an immutable, selected-installation publisher cohort without trusting caller inventory. */
export function GitHubReleaseWavePublicationCohortAdapter(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
): ReleaseWavePublicationCohortPort {
  validateInput(input);
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
  const repositories = await selectedRepositoriesAsync(input);
  const byPackage = uniqueRepositoriesByPackage(repositories);
  const expected = expectedPublisherPackages(repositories, pendingEvents, byPackage);
  if (expected === undefined) return undefined;
  const events = pendingEvents.filter((event) => expected.has(event.packageName));
  if (events.length !== expected.size) return undefined;
  const publications = await Promise.all(
    events.map((event) => settledPublicationAsync(input, event, byPackage.get(event.packageName))),
  );
  if (publications.some((publication) => publication === undefined)) return undefined;
  return { publications: publications.filter(isPublication), repositories };
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
  const manifest = await contentAsync<PackageManifest>(
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
  return profileFromManifest(repository, manifest, workflow);
}

/*** Expand every pending publisher through selected consumers to the full direct-upstream cohort. */
function expectedPublisherPackages(
  repositories: readonly ReleaseWaveRepository[],
  events: Parameters<
    ReleaseWavePublicationCohortPort['collectReleaseWavePublicationCohortAsync']
  >[0]['pendingEvents'],
  byPackage: ReadonlyMap<string, ReleaseWaveRepository>,
): ReadonlySet<string> | undefined {
  const initial = events.map((event) => event.packageName);
  if (initial.some((packageName) => !byPackage.has(packageName))) return undefined;
  const expected = new Set(initial);
  for (;;) {
    const consumers = repositories.filter((repository) =>
      dependenciesOf(repository).some((dependency) => expected.has(dependency)),
    );
    const next = consumers.flatMap((repository) =>
      dependenciesOf(repository).filter((dependency) => byPackage.has(dependency)),
    );
    const { size } = expected;
    for (const packageName of next) expected.add(packageName);
    if (size === expected.size) return expected;
  }
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
  manifest: PackageManifest,
  workflow: string | undefined,
): ReleaseWaveRepository {
  const { full_name: fullName } = repository;
  if (!fullName) throw new Error('Selected installation repository name is incomplete.');
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
  };
}

/*** Preserve only declared dependency maps, treating malformed manifest fields as empty rather than trusted. */
function dependencySections(manifest: PackageManifest): ReleaseWaveRepository['dependencies'] {
  return {
    dependencies: stringRecord(manifest.dependencies),
    devDependencies: stringRecord(manifest.devDependencies),
    optionalDependencies: stringRecord(manifest.optionalDependencies),
    peerDependencies: stringRecord(manifest.peerDependencies),
  };
}

/*** Enumerate all dependency declarations relevant to update-cohort closure. */
function dependenciesOf(repository: ReleaseWaveRepository): readonly string[] {
  return [
    ...Object.keys(repository.dependencies.dependencies),
    ...Object.keys(repository.dependencies.devDependencies),
    ...Object.keys(repository.dependencies.optionalDependencies),
  ];
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

/*** Decode an immutable GitHub contents response. */
async function contentAsync<T>(
  input: GitHubReleaseWavePublicationCohortAdapterInput,
  repository: string,
  path: string,
  revision: string,
): Promise<T> {
  const content = await jsonAsync<{ readonly content?: string; readonly encoding?: string }>(
    input,
    '/repos/' + repository + '/contents/' + path + '?ref=' + encodeURIComponent(revision),
  );
  if (content.encoding !== 'base64' || !content.content)
    throw new Error('Selected installation content is not a readable base64 file.');
  return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')) as T;
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
function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/*** Reject incomplete composition before attempting an authenticated inventory snapshot. */
function validateInput(input: GitHubReleaseWavePublicationCohortAdapterInput): void {
  if (!input.apiBaseUrl || !input.token)
    throw new Error('Release-wave cohort adapter configuration is incomplete.');
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
