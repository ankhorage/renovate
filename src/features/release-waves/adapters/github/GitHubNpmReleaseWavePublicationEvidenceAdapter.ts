import { validateReleaseWaveEvent } from '../../domain/releaseWaveEventIdentity.js';
import type { ReleaseWavePublicationEvidencePort } from '../../ports/releaseWavePublicationEvidence.js';

interface GitHubNpmReleaseWavePublicationEvidenceAdapterInput {
  readonly apiBaseUrl: string;
  readonly npmRegistryUrl: string;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly token: string;
}

/*** Verify the publisher's stable dispatch fields against authenticated GitHub and exact npm data. */
export function GitHubNpmReleaseWavePublicationEvidenceAdapter(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
): ReleaseWavePublicationEvidencePort {
  validateInput(input);
  return { enrichPackageReleaseAsync: (dispatch) => enrichPackageReleaseAsync(input, dispatch) };
}

/*** Read and bind the exact npm artifact and GitHub release without trusting dispatch additions. */
async function enrichPackageReleaseAsync(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
  dispatch: {
    readonly package_name: string;
    readonly source_repository: string;
    readonly version: string;
  },
) {
  const [npmManifest, release] = await Promise.all([
    jsonAsync<NpmManifest>(
      input,
      input.npmRegistryUrl +
        '/' +
        encodeURIComponent(dispatch.package_name) +
        '/' +
        encodeURIComponent(dispatch.version),
      {},
    ),
    jsonAsync<GitHubRelease>(
      input,
      input.apiBaseUrl +
        '/repos/' +
        dispatch.source_repository +
        '/releases/tags/' +
        encodeURIComponent('v' + dispatch.version),
      { authorization: 'Bearer ' + input.token, accept: 'application/vnd.github+json' },
    ),
  ]);
  const event = {
    npmArtifactIntegrity: npmManifest.dist?.integrity ?? '',
    packageName: dispatch.package_name,
    releaseId: String(release.id ?? ''),
    releaseTag: release.tag_name ?? '',
    sourceRepository: dispatch.source_repository,
    version: dispatch.version,
  };
  if (
    npmManifest.name !== event.packageName ||
    npmManifest.version !== event.version ||
    !npmManifestRepositoryMatches(npmManifest.repository?.url, event.sourceRepository) ||
    release.draft === true ||
    event.releaseTag !== 'v' + event.version
  )
    throw new Error('Release-wave publication evidence does not match the publisher dispatch.');
  validateReleaseWaveEvent(event);
  return event;
}

/*** Decode one successful provider response and fail closed for absence, authorization, or malformed JSON. */
async function jsonAsync<T>(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<T> {
  const response = await input.requestAsync(url, { headers });
  if (!response.ok) throw new Error('Release-wave publication evidence could not be verified.');
  return response.json() as Promise<T>;
}

/*** Require the npm package provenance URL to point exactly at the dispatched source repository. */
function npmManifestRepositoryMatches(
  repositoryUrl: string | undefined,
  sourceRepository: string,
): boolean {
  return (
    repositoryUrl !== undefined &&
    /^(?:git\+)?https:\/\/github\.com\/([^/]+\/[^/#]+?)(?:\.git)?(?:#.*)?$/.exec(
      repositoryUrl,
    )?.[1] === sourceRepository
  );
}

/*** Reject incomplete adapter configuration before making any provider request. */
function validateInput(input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput): void {
  if (!input.apiBaseUrl || !input.npmRegistryUrl || !input.token)
    throw new Error('Release-wave publication evidence adapter configuration is incomplete.');
}

interface NpmManifest {
  readonly dist?: { readonly integrity?: string };
  readonly name?: string;
  readonly repository?: { readonly url?: string };
  readonly version?: string;
}

interface GitHubRelease {
  readonly draft?: boolean;
  readonly id?: number | string;
  readonly tag_name?: string;
}
