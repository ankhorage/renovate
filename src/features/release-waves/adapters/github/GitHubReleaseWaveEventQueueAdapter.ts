import type {
  ReleaseWaveEventQueue,
  ReleaseWaveEventQueuePort,
} from '../../ports/releaseWaveEventQueue.js';
import { ReleaseWaveEventQueueConflictError } from '../../ports/releaseWaveEventQueue.js';

interface GitHubContentsClient {
  readonly repos: {
    readonly createOrUpdateFileContents: (input: {
      readonly branch: string;
      readonly content: string;
      readonly message: string;
      readonly owner: string;
      readonly path: string;
      readonly repo: string;
      readonly sha?: string;
    }) => Promise<{ readonly data: { readonly content: { readonly sha: string } } }>;
    readonly getContent: (input: {
      readonly owner: string;
      readonly path: string;
      readonly ref: string;
      readonly repo: string;
    }) => Promise<{ readonly data: GitHubFile }>;
  };
}

interface GitHubFile {
  readonly content?: string;
  readonly encoding?: string;
  readonly sha: string;
  readonly type: string;
}

interface GitHubReleaseWaveEventQueueAdapterInput {
  readonly branch: string;
  readonly client: GitHubContentsClient;
  readonly owner: string;
  readonly repository: string;
}

/** Persist release dispatches in one GitHub Contents document guarded by the content SHA. */
export function GitHubReleaseWaveEventQueueAdapter(
  input: GitHubReleaseWaveEventQueueAdapterInput,
): ReleaseWaveEventQueuePort {
  return {
    loadReleaseWaveEventQueueAsync: () => loadReleaseWaveEventQueueAsync(input),
    saveReleaseWaveEventQueueAsync: (queue, revision) =>
      saveReleaseWaveEventQueueAsync(input, queue, revision),
  };
}

/** Load one queue snapshot and its authoritative GitHub revision. */
async function loadReleaseWaveEventQueueAsync(
  input: GitHubReleaseWaveEventQueueAdapterInput,
): Promise<{ readonly queue: ReleaseWaveEventQueue; readonly revision?: string } | undefined> {
  try {
    const response = await input.client.repos.getContent({
      owner: input.owner,
      path: queuePath(),
      ref: input.branch,
      repo: input.repository,
    });
    if (
      response.data.type !== 'file' ||
      response.data.encoding !== 'base64' ||
      !response.data.content
    )
      throw new Error('Release-wave event queue must be a base64 GitHub file.');
    return {
      queue: parseQueue(Buffer.from(response.data.content, 'base64').toString('utf8')),
      revision: response.data.sha,
    };
  } catch (error) {
    if (githubFailureStatus(error) === 404) return undefined;
    throw error;
  }
}

/** Save only against the previously observed content SHA, including first-write races. */
async function saveReleaseWaveEventQueueAsync(
  input: GitHubReleaseWaveEventQueueAdapterInput,
  queue: ReleaseWaveEventQueue,
  expectedRevision: string | undefined,
): Promise<{ readonly queue: ReleaseWaveEventQueue; readonly revision?: string }> {
  try {
    const response = await input.client.repos.createOrUpdateFileContents({
      branch: input.branch,
      content: Buffer.from(JSON.stringify(queue) + '\n').toString('base64'),
      message: 'chore(release-wave): ingest release events',
      owner: input.owner,
      path: queuePath(),
      repo: input.repository,
      ...(expectedRevision === undefined ? {} : { sha: expectedRevision }),
    });
    return { queue, revision: response.data.content.sha };
  } catch (error) {
    if ([409, 422].includes(githubFailureStatus(error) ?? 0))
      throw new ReleaseWaveEventQueueConflictError();
    throw error;
  }
}

/** Keep the durable event stream separate from immutable per-run checkpoints. */
function queuePath(): string {
  return '.github/release-wave-events.json';
}

/** Validate persisted shape before it can choose a coordinator run. */
function parseQueue(source: string): ReleaseWaveEventQueue {
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('events' in value) ||
    !Array.isArray(value.events)
  )
    throw new Error('Release-wave event queue has an invalid envelope.');
  if (value.events.some((event) => !isEvent(event)))
    throw new Error('Release-wave event queue contains an invalid event.');
  return value as ReleaseWaveEventQueue;
}

/** Validate only persisted data needed to reconstruct deterministic identities. */
function isEvent(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'eventId' in value &&
    'packageName' in value &&
    'sourceRepository' in value &&
    'version' in value &&
    typeof value.eventId === 'string' &&
    typeof value.packageName === 'string' &&
    typeof value.sourceRepository === 'string' &&
    typeof value.version === 'string' &&
    (!('acknowledgedRunId' in value) || typeof value.acknowledgedRunId === 'string')
  );
}

/** Read an HTTP-like status without importing an Octokit implementation inward. */
function githubFailureStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { readonly status?: number }).status
    : undefined;
}
