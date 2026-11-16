import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type {
  ReleaseWaveExecutionPort,
  ReleaseWaveVerification,
} from '../../ports/releaseWaveExecution.js';

interface GitHubPullRequest {
  readonly head: { readonly ref: string; readonly sha: string };
  readonly merge_commit_sha: string | null;
  readonly merged_at: string | null;
  readonly number: number;
  readonly state: string;
}

export interface GitHubNpmReleaseWaveExecutionAdapterInput {
  readonly apiBaseUrl: string;
  readonly npmRegistryUrl: string;
  readonly owner: string;
  readonly renovateAsync: (repository: string) => Promise<void>;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly token: string;
}

/*** Adapt authenticated GitHub and npm evidence to the durable release-wave execution port. */
export function GitHubNpmReleaseWaveExecutionAdapter(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
): ReleaseWaveExecutionPort {
  validateAdapterInput(input);
  return {
    reconcileReleaseWaveRepositoryAsync: async ({ node, operationId }) =>
      reconcileReleaseWaveRepositoryAsync(input, node, operationId),
    ensureReleaseWaveRepositoryAsync: async ({ node, operationId }) =>
      ensureReleaseWaveRepositoryAsync(input, node, operationId),
    verifyReleaseWaveRepositoryAsync: async ({ node, runId }) =>
      verifyReleaseWaveRepositoryAsync(input, node, runId),
  };
}

/*** Reconcile an operation marker with its sole Renovate-owned grouped candidate before mutation. */
async function reconcileReleaseWaveRepositoryAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  operationId: string,
): Promise<'awaiting-review' | 'released' | 'missing'> {
  const pullRequest = await findReleaseWavePullRequestAsync(input, node.repository, operationId);
  if (pullRequest === undefined) return 'missing';
  return pullRequest.merged_at === null ? 'awaiting-review' : 'released';
}

/*** Ask the canonical Renovate writer for one grouped candidate and bind its durable operation marker. */
async function ensureReleaseWaveRepositoryAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  operationId: string,
): Promise<void> {
  await input.renovateAsync(node.repository);
  const pullRequest = await findReleaseWavePullRequestAsync(input, node.repository, operationId);
  if (pullRequest !== undefined) return;
  const candidate = await findGroupedRenovatePullRequestAsync(input, node.repository);
  if (candidate === undefined)
    throw new ReleaseWaveProviderError(
      'candidate-missing',
      'Renovate did not create a grouped candidate.',
    );
  await githubRequestAsync(
    input,
    '/repos/' + node.repository + '/issues/' + candidate.number + '/labels',
    {
      body: JSON.stringify({ labels: [operationLabel(operationId)] }),
      method: 'POST',
    },
  );
}

/*** Gather fail-closed GitHub and npm proof for a candidate without treating absence as success. */
async function verifyReleaseWaveRepositoryAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  runId: string,
): Promise<ReleaseWaveVerification> {
  const operationId = runId + ':' + node.repository;
  const pullRequest = await findReleaseWavePullRequestAsync(input, node.repository, operationId);
  if (pullRequest === undefined || pullRequest.merged_at === null) return incompleteVerification;
  const [reviews, checks, files, release] = await Promise.all([
    githubJsonAsync<readonly { readonly state: string }[]>(
      input,
      '/repos/' + node.repository + '/pulls/' + pullRequest.number + '/reviews',
    ),
    githubJsonAsync<{
      readonly check_runs: readonly {
        readonly conclusion: string | null;
        readonly status: string;
      }[];
    }>(input, '/repos/' + node.repository + '/commits/' + pullRequest.head.sha + '/check-runs'),
    githubJsonAsync<readonly { readonly filename: string }[]>(
      input,
      '/repos/' + node.repository + '/pulls/' + pullRequest.number + '/files',
    ),
    githubOptionalJsonAsync<{ readonly target_commitish: string }>(
      input,
      '/repos/' + node.repository + '/releases/latest',
    ),
  ]);
  const exactHeadCiPassed =
    checks.check_runs.length > 0 && checks.check_runs.every(isSuccessfulCheck);
  const requiredReviewsApproved = reviews.some((review) => review.state === 'APPROVED');
  const lockfileUpdated = files.some((file) => isLockfile(file.filename));
  const documentationGenerated = files.some((file) => isDocumentationArtifact(file.filename));
  const releaseWorkflowPassed =
    pullRequest.merge_commit_sha !== null &&
    release?.target_commitish === pullRequest.merge_commit_sha;
  const npmVerified =
    node.requiresNpmPublication && releaseWorkflowPassed
      ? await isExactNpmArtifactAsync(input, node.packageName)
      : false;
  return {
    documentationGenerated,
    exactHeadCiPassed,
    lockfileUpdated,
    npmArtifactVerified: node.requiresNpmPublication ? npmVerified : undefined,
    npmVersionVerified: node.requiresNpmPublication ? npmVerified : undefined,
    releaseWorkflowPassed,
    requiredReviewsApproved,
  };
}

/*** Find the one Renovate PR already bound to the durable operation identity. */
async function findReleaseWavePullRequestAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  repository: string,
  operationId: string,
): Promise<GitHubPullRequest | undefined> {
  const issues = await githubJsonAsync<readonly { readonly number: number }[]>(
    input,
    '/repos/' +
      repository +
      '/issues?state=all&labels=' +
      encodeURIComponent(operationLabel(operationId)),
  );
  const [issue] = issues;
  return issue === undefined
    ? undefined
    : githubJsonAsync<GitHubPullRequest>(input, '/repos/' + repository + '/pulls/' + issue.number);
}

/*** Locate only the stable, Renovate-authored release-wave branch; unrelated PRs are ignored. */
async function findGroupedRenovatePullRequestAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  repository: string,
): Promise<GitHubPullRequest | undefined> {
  const pulls = await githubJsonAsync<readonly GitHubPullRequest[]>(
    input,
    '/repos/' +
      repository +
      '/pulls?state=open&head=' +
      encodeURIComponent(input.owner + ':renovate/ankhorage-release-wave'),
  );
  return pulls.find((pull) => pull.head.ref === 'renovate/ankhorage-release-wave');
}

/*** Require a successful completed check; queued, cancelled, skipped, failed, and absent checks fail closed. */
function isSuccessfulCheck(check: {
  readonly conclusion: string | null;
  readonly status: string;
}): boolean {
  return check.status === 'completed' && check.conclusion === 'success';
}

/*** Verify the current npm manifest and tarball exist for the candidate package identity. */
async function isExactNpmArtifactAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  packageName: string,
): Promise<boolean> {
  const response = await input.requestAsync(
    input.npmRegistryUrl + '/' + encodeURIComponent(packageName),
    {
      headers: { accept: 'application/json' },
    },
  );
  if (!response.ok) return false;
  const manifest = (await response.json()) as {
    readonly 'dist-tags'?: { readonly latest?: string };
    readonly versions?: Readonly<Record<string, { readonly dist?: { readonly tarball?: string } }>>;
  };
  const version = manifest['dist-tags']?.latest;
  const tarball = Object.entries(manifest.versions ?? {}).find(
    ([candidateVersion]) => candidateVersion === version,
  )?.[1].dist?.tarball;
  if (version === undefined || tarball === undefined) return false;
  return (await input.requestAsync(tarball, { method: 'HEAD' })).ok;
}

/*** Make an authenticated GitHub API request and classify provider failures without persisting secrets. */
async function githubRequestAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await input.requestAsync(input.apiBaseUrl + path, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + input.token,
      ...init.headers,
    },
  });
  if (response.ok) return response;
  throw new ReleaseWaveProviderError(
    providerFailureCode(response.status),
    'GitHub provider request was not accepted.',
  );
}

/*** Decode an authenticated GitHub JSON response. */
async function githubJsonAsync<T>(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
): Promise<T> {
  return (await githubRequestAsync(input, path)).json() as Promise<T>;
}

/*** Read an optional GitHub resource without converting an expected absence into a success. */
async function githubOptionalJsonAsync<T>(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
): Promise<T | undefined> {
  try {
    return await githubJsonAsync<T>(input, path);
  } catch (error) {
    if (error instanceof ReleaseWaveProviderError && error.code === 'missing-resource')
      return undefined;
    throw error;
  }
}

/*** Keep generated documentation and lockfile evidence explicit rather than inferred from a green check. */
function isDocumentationArtifact(path: string): boolean {
  return path === 'README.md' || path.startsWith('paradox/');
}
/*** Recognize the package-manager lockfiles Renovate may update. */
function isLockfile(path: string): boolean {
  return (
    path === 'bun.lock' ||
    path === 'package-lock.json' ||
    path === 'pnpm-lock.yaml' ||
    path === 'yarn.lock'
  );
}
/*** Use a namespaced, opaque label rather than embedding provider data in a PR title. */
function operationLabel(operationId: string): string {
  return 'release-wave:' + createHash('sha256').update(operationId).digest('hex');
}
/*** Classify recoverable provider failures for the durable executor without retaining raw responses. */
function providerFailureCode(status: number): string {
  return status === 401 || status === 403
    ? 'credentials-or-rate-limit'
    : status === 404
      ? 'missing-resource'
      : 'provider-failed';
}
/*** Validate credentials and endpoint configuration before a provider operation starts. */
function validateAdapterInput(input: GitHubNpmReleaseWaveExecutionAdapterInput): void {
  if (!input.apiBaseUrl || !input.npmRegistryUrl || !input.owner || !input.token)
    throw new Error('Release-wave GitHub/npm adapter configuration is incomplete.');
}

/*** Represent a bounded provider failure suitable for safe durable failure classification. */
class ReleaseWaveProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReleaseWaveProviderError';
  }
}

const incompleteVerification: ReleaseWaveVerification = {
  documentationGenerated: false,
  exactHeadCiPassed: false,
  lockfileUpdated: false,
  releaseWorkflowPassed: false,
  requiredReviewsApproved: false,
};
import { createHash } from 'node:crypto';
