import { createHash } from 'node:crypto';

import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type { ReleaseWaveVerification } from '../../ports/releaseWaveExecution.js';
import type { GitHubNpmReleaseWaveExecutionAdapterInput } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveCandidate } from './githubReleaseWaveCandidate.js';
import { githubReleaseWaveClient } from './githubReleaseWaveClient.js';
import { githubReleaseWaveConsumerEvidenceAsync } from './githubReleaseWaveConsumerEvidence.js';

interface PullRequest {
  readonly base: { readonly ref: string; readonly sha: string };
  readonly head: { readonly sha: string };
  readonly mergeable: boolean | null;
  readonly merge_commit_sha: string | null;
  readonly mergeable_state: string;
  readonly merged_at: string | null;
  readonly number: number;
  readonly user: { readonly login: string; readonly type: string };
}

interface GitReference {
  readonly object: { readonly sha: string; readonly type: 'commit' | 'tag' };
}

interface GitTag {
  readonly object: { readonly sha: string; readonly type: 'commit' | 'tag' };
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
  const evidence = await githubEvidenceAsync(input, client, node, pull, pull.merge_commit_sha);
  const releaseRevision = evidence.releaseRun?.head_sha;
  const releaseWorkflowPassed = releaseRevision !== undefined;
  const npmVerified =
    node.requiresNpmPublication && releaseWorkflowPassed
      ? await npmArtifactAsync(input, node)
      : false;
  return {
    documentationGenerated:
      releaseWorkflowPassed && (await generatedDocsAsync(client, node.repository, releaseRevision)),
    exactHeadCiPassed: requiredContextsPassed(
      evidence.protection,
      evidence.checks,
      evidence.statuses,
    ),
    lockfileUpdated: await githubReleaseWaveConsumerEvidenceAsync(
      client,
      node,
      pull,
      evidence.files,
    ),
    npmArtifactVerified: node.requiresNpmPublication ? npmVerified : undefined,
    npmVersionVerified: node.requiresNpmPublication ? npmVerified : undefined,
    releaseWorkflowPassed,
    requiredReviewsApproved: requiredReviewsPassed(evidence.protection, evidence.reviews, pull),
  };
}

/** Read every bounded GitHub evidence collection against the reconciled candidate. */
async function githubEvidenceAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  client: ReturnType<typeof githubReleaseWaveClient>,
  node: ReleaseWaveNode,
  pull: PullRequest,
  candidateRevision: string,
) {
  const [protection, reviews, checks, statuses, releaseRun, files] = await Promise.all([
    client.jsonAsync<Protection>(
      '/repos/' +
        node.repository +
        '/branches/' +
        encodeURIComponent(pull.base.ref) +
        '/protection',
    ),
    client.pagesAsync<Review>('/repos/' + node.repository + '/pulls/' + pull.number + '/reviews'),
    client.pagesAsync<{
      readonly conclusion: string | null;
      readonly name: string;
      readonly status: string;
    }>(`/repos/${node.repository}/commits/${pull.head.sha}/check-runs`, 'check_runs'),
    client.pagesAsync<{ readonly context: string; readonly state: string }>(
      '/repos/' + node.repository + '/commits/' + pull.head.sha + '/status',
      'statuses',
    ),
    releaseEvidenceAsync(
      input,
      node.repository,
      node.expectedPublication?.version,
      candidateRevision,
    ),
    client.pagesAsync<{ readonly filename: string }>(
      '/repos/' + node.repository + '/pulls/' + pull.number + '/files',
    ),
  ]);
  return { checks, files, protection, releaseRun, reviews, statuses };
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
  reviews: readonly Review[],
  pull: PullRequest,
): boolean {
  const policy = protection.required_pull_request_reviews;
  if (policy === undefined || pull.mergeable !== true || pull.mergeable_state !== 'clean')
    return false;
  const current = new Map<string, Review>();
  for (const review of reviews) {
    if (review.user.type !== 'User' || review.user.login === pull.user.login) continue;
    current.set(review.user.login, review);
  }
  return (
    [...current.values()].filter((review) => review.state === 'APPROVED').length >=
    (policy.required_approving_review_count ?? 0)
  );
}

interface Review {
  readonly state: string;
  readonly user: { readonly login: string; readonly type: string };
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

/** Bind a planned version to its peeled immutable tag, descendant release commit, and successful run. */
async function releaseEvidenceAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  repository: string,
  version: string | undefined,
  candidateRevision: string,
): Promise<{ readonly head_sha: string } | undefined> {
  if (version === undefined) return undefined;
  const client = githubReleaseWaveClient(input);
  const tagRevision = await resolveTagRevisionAsync(client, repository, 'v' + version);
  if (tagRevision === undefined) return undefined;
  const comparison = await client.jsonAsync<{ readonly status: string }>(
    `/repos/${repository}/compare/${candidateRevision}...${tagRevision}`,
  );
  if (!['ahead', 'identical'].includes(comparison.status)) return undefined;
  const run = await releaseRunAsync(input, repository, tagRevision);
  return run?.head_sha === tagRevision ? run : undefined;
}

/** Resolve lightweight and annotated tags to the immutable commit GitHub actually references. */
async function resolveTagRevisionAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  tag: string,
): Promise<string | undefined> {
  let reference = await client.jsonAsync<GitReference>(
    '/repos/' + repository + '/git/ref/tags/' + encodeURIComponent(tag),
  );
  for (let depth = 0; depth < 10; depth += 1) {
    if (reference.object.type === 'commit') return reference.object.sha;
    const annotated = await client.jsonAsync<GitTag>(
      '/repos/' + repository + '/git/tags/' + encodeURIComponent(reference.object.sha),
    );
    reference = { object: annotated.object };
  }
  return undefined;
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

/*** Download the exact planned artifact and compare its SHA-512 SRI with registry evidence. */
async function npmArtifactAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  node: ReleaseWaveNode,
): Promise<boolean> {
  const expected = node.expectedPublication;
  if (expected === undefined) return false;
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
    dist?.integrity === undefined ||
    dist.tarball === undefined ||
    !trustedTarball(input.npmRegistryUrl, dist.tarball)
  )
    return false;
  const artifact = await input.requestAsync(dist.tarball);
  if (!artifact.ok) return false;
  const integrity =
    'sha512-' +
    createHash('sha512')
      .update(Buffer.from(await artifact.arrayBuffer()))
      .digest('base64');
  return integrity === dist.integrity;
}

/*** Permit registry artifacts only from the configured registry origin. */
function trustedTarball(registry: string, tarball: string): boolean {
  try {
    return new URL(registry).origin === new URL(tarball).origin;
  } catch {
    return false;
  }
}

/*** Derive the candidate marker without exposing the durable operation identity. */
function label(operationId: string): string {
  return 'release-wave:' + createHash('sha256').update(operationId).digest('hex');
}
