import type {
  ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointPort,
  RevisionedReleaseWaveCheckpoint,
} from '../../ports/releaseWaveCheckpoint.js';
import {
  ReleaseWaveCheckpointConflictError,
} from '../../ports/releaseWaveCheckpoint.js';

interface GitHubFileContentsClient {
  readonly repos: {
    readonly createOrUpdateFileContents: (input: {
      readonly branch: string;
      readonly content: string;
      readonly message: string;
      readonly owner: string;
      readonly path: string;
      readonly repo: string;
      readonly sha?: string;
    }) => Promise<{
      readonly data: { readonly content: { readonly sha: string } };
    }>;
    readonly getContent: (input: {
      readonly owner: string;
      readonly path: string;
      readonly ref: string;
      readonly repo: string;
    }) => Promise<{
      readonly data: {
        readonly content: string;
        readonly encoding: string;
        readonly sha: string;
        readonly type: string;
      };
    }>;
  };
}

interface GitHubFailure {
  readonly status?: number;
}

interface GitHubReleaseWaveCheckpointAdapterInput {
  readonly branch: string;
  readonly client: GitHubFileContentsClient;
  readonly owner: string;
  readonly repository: string;
}

/*** Persist release-wave state in a dedicated GitHub ref using content SHA compare-and-swap. */
export function GitHubReleaseWaveCheckpointAdapter(
  input: GitHubReleaseWaveCheckpointAdapterInput,
): ReleaseWaveCheckpointPort {
  return {
    loadReleaseWaveCheckpointAsync: (runId) => loadReleaseWaveCheckpointAsync(input, runId),
    saveReleaseWaveCheckpointAsync: (runId, checkpoint, expectedRevision) =>
      saveReleaseWaveCheckpointAsync(input, runId, checkpoint, expectedRevision),
  };
}

/*** Read one durable checkpoint and its authoritative GitHub content revision. */
async function loadReleaseWaveCheckpointAsync(
  input: GitHubReleaseWaveCheckpointAdapterInput,
  runId: string,
): Promise<RevisionedReleaseWaveCheckpoint | undefined> {
  try {
    const response = await input.client.repos.getContent({
      owner: input.owner,
      path: releaseWaveCheckpointPath(runId),
      ref: input.branch,
      repo: input.repository,
    });
    if (response.data.type !== 'file' || response.data.encoding !== 'base64') {
      throw new Error('Release-wave checkpoint must be a base64 GitHub file.');
    }
    return {
      checkpoint: parseReleaseWaveCheckpoint(
        Buffer.from(response.data.content, 'base64').toString('utf8'),
      ),
      revision: response.data.sha,
    };
  } catch (error) {
    if (githubFailureStatus(error) === 404) return undefined;
    throw error;
  }
}

/*** Atomically write a checkpoint only when the caller still owns the observed GitHub revision. */
async function saveReleaseWaveCheckpointAsync(
  input: GitHubReleaseWaveCheckpointAdapterInput,
  runId: string,
  checkpoint: ReleaseWaveCheckpoint,
  expectedRevision: string | undefined,
): Promise<RevisionedReleaseWaveCheckpoint> {
  try {
    const response = await input.client.repos.createOrUpdateFileContents({
      branch: input.branch,
      content: Buffer.from(JSON.stringify(checkpoint) + '\n').toString('base64'),
      message: 'chore(release-wave): checkpoint ' + runId,
      owner: input.owner,
      path: releaseWaveCheckpointPath(runId),
      repo: input.repository,
      ...(expectedRevision === undefined ? {} : { sha: expectedRevision }),
    });
    return { checkpoint, revision: response.data.content.sha };
  } catch (error) {
    if (githubFailureStatus(error) === 409 || githubFailureStatus(error) === 422) {
      throw new ReleaseWaveCheckpointConflictError(runId);
    }
    throw error;
  }
}

/*** Convert a run identifier into a traversal-safe state file path. */
function releaseWaveCheckpointPath(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new Error('Release-wave checkpoint run identifier is invalid.');
  }
  return '.github/release-wave-checkpoints/' + runId + '.json';
}

/*** Decode and validate the durable checkpoint envelope before resuming side effects. */
function parseReleaseWaveCheckpoint(source: string): ReleaseWaveCheckpoint {
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ledger' in value) ||
    !('plan' in value) ||
    typeof value.ledger !== 'object' ||
    value.ledger === null ||
    typeof value.plan !== 'object' ||
    value.plan === null
  ) {
    throw new Error('Release-wave checkpoint has an invalid envelope.');
  }
  return value as ReleaseWaveCheckpoint;
}

/*** Read an HTTP-like GitHub failure status without coupling the port to Octokit error classes. */
function githubFailureStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as GitHubFailure).status
    : undefined;
}
