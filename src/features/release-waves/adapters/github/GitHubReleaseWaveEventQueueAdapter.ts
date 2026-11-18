import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
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
  const envelope = value as { readonly acknowledgedEvents?: unknown; readonly events: unknown[] };
  const events = envelope.events as ReleaseWaveEventQueue['events'];
  const ids = new Set(events.map((event) => event.eventId));
  if (ids.size !== events.length)
    throw new Error('Release-wave event queue contains duplicate event identities.');
  if (!isAcknowledgedEvents(envelope))
    throw new Error('Release-wave event queue acknowledgement ledger is invalid.');
  if (
    events.some(
      (event) =>
        envelope.acknowledgedEvents?.[event.eventId] !== undefined ||
        event.acknowledgedRunId !== undefined,
    )
  )
    throw new Error('Release-wave event queue contains an invalid acknowledgement state.');
  return { acknowledgedEvents: envelope.acknowledgedEvents, events };
}

/** Validate only persisted data needed to reconstruct deterministic identities. */
function isEvent(value: unknown): boolean {
  return isEventShape(value) && hasCanonicalEventIdentity(value);
}

/** Validate the persisted scalar fields before reconstructing the canonical identity. */
function isEventShape(value: unknown): value is {
  readonly eventId: string;
  readonly npmArtifactIntegrity: string;
  readonly packageName: string;
  readonly releaseId: string;
  readonly releaseTag: string;
  readonly sourceRepository: string;
  readonly version: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    isEventAcknowledgementShape(value) &&
    hasStringProperties(value, [
      'eventId',
      'npmArtifactIntegrity',
      'packageName',
      'releaseId',
      'releaseTag',
      'sourceRepository',
      'version',
    ])
  );
}

/** Require scalar event fields without trusting provider-decoded JSON as a typed record. */
function hasStringProperties(value: object, keys: readonly string[]): boolean {
  const record = value as Readonly<Record<string, unknown>>;
  return keys.every(
    (key) => typeof Object.getOwnPropertyDescriptor(record, key)?.value === 'string',
  );
}

/** Accept only an omitted or string acknowledgement marker before the queue transition validates it. */
function isEventAcknowledgementShape(value: object): boolean {
  return !('acknowledgedRunId' in value) || typeof value.acknowledgedRunId === 'string';
}

/** Reject an event whose stored id cannot be regenerated from immutable content. */
function hasCanonicalEventIdentity(event: {
  readonly eventId: string;
  readonly npmArtifactIntegrity: string;
  readonly packageName: string;
  readonly releaseId: string;
  readonly releaseTag: string;
  readonly sourceRepository: string;
  readonly version: string;
}): boolean {
  return event.eventId === releaseWaveEventIdentity(event);
}

/** Validate compacted acknowledgement records before they can suppress a replay. */
function isAcknowledgedEvents(value: {
  readonly acknowledgedEvents?: unknown;
}): value is { readonly acknowledgedEvents?: Readonly<Record<string, string>> } {
  return (
    value.acknowledgedEvents === undefined ||
    (typeof value.acknowledgedEvents === 'object' &&
      value.acknowledgedEvents !== null &&
      Object.entries(value.acknowledgedEvents).every(
        ([eventId, runId]) =>
          /^[a-f0-9]{64}$/.test(eventId) && typeof runId === 'string' && runId.length > 0,
      ))
  );
}

/** Read an HTTP-like status without importing an Octokit implementation inward. */
function githubFailureStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { readonly status?: number }).status
    : undefined;
}
