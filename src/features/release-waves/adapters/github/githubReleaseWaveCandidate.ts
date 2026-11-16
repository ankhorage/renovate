import { createHash } from 'node:crypto';

import type { ReleaseWaveNode } from '../../../../types/releaseWave.js';
import type { GitHubNpmReleaseWaveExecutionAdapterInput } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveClient } from './githubReleaseWaveClient.js';

interface PullRequest {
  readonly head: { readonly ref: string };
  readonly merged_at: string | null;
  readonly number: number;
}

/*** Reconcile and create one deterministic, labelled Renovate release-wave candidate. */
export function githubReleaseWaveCandidate(input: GitHubNpmReleaseWaveExecutionAdapterInput) {
  const client = githubReleaseWaveClient(input);
  return {
    ensureAsync: (node: ReleaseWaveNode, operationId: string): Promise<void> =>
      ensureAsync(input, client, node, operationId),
    reconcileAsync: (
      node: ReleaseWaveNode,
      operationId: string,
    ): Promise<'awaiting-review' | 'released' | 'missing'> =>
      reconcileAsync(client, node, operationId),
  };
}

/*** Return durable candidate state without treating a merged PR as release proof. */
async function reconcileAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  node: ReleaseWaveNode,
  operationId: string,
): Promise<'awaiting-review' | 'released' | 'missing'> {
  const pull = await markedPullAsync(client, node.repository, operationId);
  return pull === undefined ? 'missing' : pull.merged_at === null ? 'awaiting-review' : 'released';
}

/*** Recover an existing candidate or label the one Renovate candidate created for this operation. */
async function ensureAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  client: ReturnType<typeof githubReleaseWaveClient>,
  node: ReleaseWaveNode,
  operationId: string,
): Promise<void> {
  if (await markedPullAsync(client, node.repository, operationId)) return;
  const candidate = await groupedPullAsync(input, client, node.repository);
  if (candidate !== undefined)
    return labelAsync(client, node.repository, candidate.number, operationId);
  await input.renovateAsync(node.repository);
  const created = await groupedPullAsync(input, client, node.repository);
  if (created === undefined) throw new Error('candidate-missing');
  await labelAsync(client, node.repository, created.number, operationId);
}

/*** Find exactly one labelled candidate over all GitHub pages. */
async function markedPullAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  operationId: string,
): Promise<PullRequest | undefined> {
  const issues = await client.pagesAsync<{ readonly number: number }>(
    '/repos/' + repository + '/issues?state=all&labels=' + encodeURIComponent(label(operationId)),
  );
  if (issues.length === 0) return undefined;
  if (issues.length !== 1) throw new Error('candidate-ambiguous');
  const [issue] = issues;
  if (issue === undefined) return undefined;
  return client.jsonAsync<PullRequest>('/repos/' + repository + '/pulls/' + issue.number);
}

/*** Locate only the stable Renovate branch; ambiguity fails before another candidate is made. */
async function groupedPullAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
): Promise<PullRequest | undefined> {
  const pulls = (
    await client.pagesAsync<PullRequest>(
      '/repos/' +
        repository +
        '/pulls?state=open&head=' +
        encodeURIComponent(input.owner + ':renovate/ankhorage-release-wave'),
    )
  ).filter((pull) => pull.head.ref === 'renovate/ankhorage-release-wave');
  if (pulls.length > 1) throw new Error('candidate-ambiguous');
  return pulls[0];
}

/*** Persist operation correlation after creation so interrupted replay adopts the same PR. */
async function labelAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  number: number,
  operationId: string,
): Promise<void> {
  await client.requestAsync('/repos/' + repository + '/issues/' + number + '/labels', {
    body: JSON.stringify({ labels: [label(operationId)] }),
    method: 'POST',
  });
}

/*** Derive opaque operation markers without embedding external identity in a PR title. */
function label(operationId: string): string {
  return 'release-wave:' + createHash('sha256').update(operationId).digest('hex');
}
