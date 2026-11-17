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
  const { npmManifest, release, tagCommit, workflows } = await loadPublisherEvidenceAsync(
    input,
    dispatch,
  );
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
    release.prerelease === true ||
    event.releaseTag !== 'v' + event.version ||
    release.target_commitish !== tagCommit ||
    npmManifest.gitHead !== tagCommit ||
    !workflows.workflow_runs.some(
      (workflow) => workflow.conclusion === 'success' && workflow.head_sha === tagCommit,
    )
  )
    throw new Error('Release-wave publication evidence does not match the publisher dispatch.');
  validateReleaseWaveEvent(event);
  return event;
}

/*** Collect independent authenticated facts before evaluating their shared publication invariant. */
async function loadPublisherEvidenceAsync(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
  dispatch: {
    readonly package_name: string;
    readonly source_repository: string;
    readonly version: string;
  },
) {
  const releaseTag = 'v' + dispatch.version;
  const [npmManifest, release, tagCommit, workflows] = await Promise.all([
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
        encodeURIComponent(releaseTag),
      githubHeaders(input),
    ),
    tagCommitAsync(input, dispatch.source_repository, releaseTag),
    jsonAsync<GitHubWorkflowRuns>(
      input,
      input.apiBaseUrl +
        '/repos/' +
        dispatch.source_repository +
        '/actions/runs?event=release&status=completed&per_page=100',
      githubHeaders(input),
    ),
  ]);
  return { npmManifest, release, tagCommit, workflows };
}

/*** Provide authenticated GitHub headers for every provenance request. */
function githubHeaders(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
): Readonly<Record<string, string>> {
  return { authorization: 'Bearer ' + input.token, accept: 'application/vnd.github+json' };
}

/*** Resolve the immutable commit behind a lightweight or annotated release tag. */
async function tagCommitAsync(
  input: GitHubNpmReleaseWavePublicationEvidenceAdapterInput,
  repository: string,
  tag: string,
): Promise<string> {
  const reference = await jsonAsync<GitHubGitReference>(
    input,
    input.apiBaseUrl + '/repos/' + repository + '/git/ref/tags/' + encodeURIComponent(tag),
    githubHeaders(input),
  );
  if (reference.object?.type === 'commit' && reference.object.sha) return reference.object.sha;
  if (reference.object?.type !== 'tag' || !reference.object.sha)
    throw new Error('Release tag does not resolve to a commit.');
  const annotated = await jsonAsync<GitHubAnnotatedTag>(
    input,
    input.apiBaseUrl + '/repos/' + repository + '/git/tags/' + reference.object.sha,
    githubHeaders(input),
  );
  if (annotated.object?.type !== 'commit' || !annotated.object.sha)
    throw new Error('Annotated release tag does not resolve to a commit.');
  return annotated.object.sha;
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
  readonly gitHead?: string;
  readonly name?: string;
  readonly repository?: { readonly url?: string };
  readonly version?: string;
}

interface GitHubRelease {
  readonly draft?: boolean;
  readonly id?: number | string;
  readonly prerelease?: boolean;
  readonly tag_name?: string;
  readonly target_commitish?: string;
}

interface GitHubGitReference {
  readonly object?: { readonly sha?: string; readonly type?: string };
}
interface GitHubAnnotatedTag {
  readonly object?: { readonly sha?: string; readonly type?: string };
}
interface GitHubWorkflowRuns {
  readonly workflow_runs: readonly { readonly conclusion?: string; readonly head_sha?: string }[];
}
