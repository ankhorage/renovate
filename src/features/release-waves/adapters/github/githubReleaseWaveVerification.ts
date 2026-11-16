import { createHash } from 'node:crypto';

import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type { ReleaseWaveVerification } from '../../ports/releaseWaveExecution.js';
import type { GitHubNpmReleaseWaveExecutionAdapterInput } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveCandidate } from './githubReleaseWaveCandidate.js';
import { githubReleaseWaveClient } from './githubReleaseWaveClient.js';

interface PullRequest {
  readonly base: { readonly ref: string };
  readonly head: { readonly sha: string };
  readonly merge_commit_sha: string | null;
  readonly merged_at: string | null;
  readonly number: number;
}

interface Protection {
  readonly required_pull_request_reviews?: {
    readonly require_code_owner_reviews?: boolean;
    readonly required_approving_review_count?: number;
  };
  readonly required_status_checks?: { readonly contexts?: readonly string[] };
}

const incomplete: ReleaseWaveVerification = {
  documentationGenerated: false,
  exactHeadCiPassed: false,
  lockfileUpdated: false,
  releaseWorkflowPassed: false,
  requiredReviewsApproved: false,
};

/*** Verify one merged candidate against current protected-release evidence. */
export async function githubReleaseWaveVerificationAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  runId: string,
): Promise<ReleaseWaveVerification> {
  const candidate = githubReleaseWaveCandidate(input);
  const state = await candidate.reconcileAsync(node, runId + ':' + node.repository);
  if (state !== 'released') return incomplete;
  try {
    return await verificationAsync(input, node, runId);
  } catch {
    return incomplete;
  }
}

/*** Gather independent policy, review, CI, release, docs, lockfile and npm evidence. */
async function verificationAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  runId: string,
): Promise<ReleaseWaveVerification> {
  const client = githubReleaseWaveClient(input);
  const pull = await labelledPullAsync(client, node.repository, runId + ':' + node.repository);
  if (pull === undefined || pull.merged_at === null || pull.merge_commit_sha === null)
    return incomplete;
  const [protection, reviews, checks, statuses, releaseRun, files] = await Promise.all([
    client.jsonAsync<Protection>(
      '/repos/' +
        node.repository +
        '/branches/' +
        encodeURIComponent(pull.base.ref) +
        '/protection',
    ),
    client.pagesAsync<{ readonly state: string; readonly user: { readonly login: string } }>(
      '/repos/' + node.repository + '/pulls/' + pull.number + '/reviews',
    ),
    client.pagesAsync<{
      readonly conclusion: string | null;
      readonly name: string;
      readonly status: string;
    }>('/repos/' + node.repository + '/commits/' + pull.head.sha + '/check-runs'),
    client.pagesAsync<{ readonly context: string; readonly state: string }>(
      '/repos/' + node.repository + '/commits/' + pull.head.sha + '/status',
    ),
    releaseRunAsync(input, node.repository, pull.merge_commit_sha),
    client.pagesAsync<{ readonly filename: string }>(
      '/repos/' + node.repository + '/pulls/' + pull.number + '/files',
    ),
  ]);
  const releaseWorkflowPassed = releaseRun !== undefined;
  const npmVerified =
    node.requiresNpmPublication && releaseWorkflowPassed
      ? await npmArtifactAsync(input, node, pull.merge_commit_sha)
      : false;
  return {
    documentationGenerated:
      releaseWorkflowPassed &&
      (await generatedDocsAsync(client, node.repository, pull.merge_commit_sha)),
    exactHeadCiPassed: requiredContextsPassed(protection, checks, statuses),
    lockfileUpdated: files.some((file) => isLockfile(file.filename)),
    npmArtifactVerified: node.requiresNpmPublication ? npmVerified : undefined,
    npmVersionVerified: node.requiresNpmPublication ? npmVerified : undefined,
    releaseWorkflowPassed,
    requiredReviewsApproved: requiredReviewsPassed(protection, reviews),
  };
}

/*** Fetch the durable labelled PR only after reconciliation has established its merged state. */
async function labelledPullAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  operationId: string,
): Promise<PullRequest | undefined> {
  const issues = await client.pagesAsync<{ readonly number: number }>(
    '/repos/' + repository + '/issues?state=all&labels=' + encodeURIComponent(label(operationId)),
  );
  const [issue] = issues;
  return issues.length === 1 && issue !== undefined
    ? client.jsonAsync<PullRequest>('/repos/' + repository + '/pulls/' + issue.number)
    : undefined;
}

/*** Require every protected context on the candidate SHA; missing policy or contexts blocks. */
function requiredContextsPassed(
  protection: Protection,
  checks: readonly {
    readonly conclusion: string | null;
    readonly name: string;
    readonly status: string;
  }[],
  statuses: readonly { readonly context: string; readonly state: string }[],
): boolean {
  const contexts = protection.required_status_checks?.contexts;
  return (
    contexts !== undefined &&
    contexts.length > 0 &&
    contexts.every(
      (context) =>
        checks.some(
          (check) =>
            check.name === context &&
            check.status === 'completed' &&
            check.conclusion === 'success',
        ) || statuses.some((status) => status.context === context && status.state === 'success'),
    )
  );
}

/*** Count each reviewer's latest effective approval; inaccessible code-owner evidence blocks. */
function requiredReviewsPassed(
  protection: Protection,
  reviews: readonly { readonly state: string; readonly user: { readonly login: string } }[],
): boolean {
  const policy = protection.required_pull_request_reviews;
  if (policy === undefined || policy.require_code_owner_reviews === true) return false;
  const current = new Map<string, string>();
  for (const review of reviews) current.set(review.user.login, review.state);
  return (
    [...current.values()].filter((state) => state === 'APPROVED').length >=
    (policy.required_approving_review_count ?? 0)
  );
}

/*** Use the named release workflow's exact successful run, never a mutable latest-release pointer. */
async function releaseRunAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  repository: string,
  revision: string,
): Promise<{ readonly head_sha: string } | undefined> {
  const client = githubReleaseWaveClient(input);
  const runs = await client.pagesAsync<{ readonly conclusion: string; readonly head_sha: string }>(
    '/repos/' +
      repository +
      '/actions/workflows/' +
      encodeURIComponent(input.releaseWorkflowFile) +
      '/runs?head_sha=' +
      encodeURIComponent(revision),
    'workflow_runs',
  );
  return runs.find((run) => run.head_sha === revision && run.conclusion === 'success');
}

/*** Read release-owned generated output at the release revision rather than candidate PR files. */
async function generatedDocsAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  revision: string,
): Promise<boolean> {
  try {
    await Promise.all([
      client.requestAsync(
        '/repos/' + repository + '/contents/README.md?ref=' + encodeURIComponent(revision),
      ),
      client.requestAsync(
        '/repos/' + repository + '/contents/paradox?ref=' + encodeURIComponent(revision),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/*** Bind planned version, release revision and integrity before contacting a registry-owned tarball. */
async function npmArtifactAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
  revision: string,
): Promise<boolean> {
  const expected = node.expectedPublication;
  if (expected?.releaseRevision !== revision) return false;
  const manifestResponse = await input.requestAsync(
    input.npmRegistryUrl + '/' + encodeURIComponent(node.packageName),
    { headers: { accept: 'application/json' } },
  );
  if (!manifestResponse.ok) return false;
  const manifest = (await manifestResponse.json()) as {
    readonly versions?: Readonly<
      Record<string, { readonly dist?: { readonly integrity?: string; readonly tarball?: string } }>
    >;
  };
  const dist = manifest.versions?.[expected.version]?.dist;
  if (
    dist?.integrity !== expected.integrity ||
    dist.tarball === undefined ||
    !trustedTarball(input.npmRegistryUrl, dist.tarball)
  )
    return false;
  return (await input.requestAsync(dist.tarball, { method: 'HEAD' })).ok;
}

/*** Permit registry artifacts only from the configured registry origin. */
function trustedTarball(registry: string, tarball: string): boolean {
  try {
    return new URL(registry).origin === new URL(tarball).origin;
  } catch {
    return false;
  }
}

/*** Keep supported lockfile formats explicit. */
function isLockfile(path: string): boolean {
  return ['bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(path);
}

/*** Derive the candidate marker without exposing the durable operation identity. */
function label(operationId: string): string {
  return 'release-wave:' + createHash('sha256').update(operationId).digest('hex');
}
