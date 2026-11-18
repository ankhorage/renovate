import type {
  ReleaseWavePublisherSnapshotAck,
  ReleaseWavePublisherSnapshotAckPort,
} from '../../ports/releaseWavePublisherSnapshot.js';

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
    }) => Promise<{ readonly data: { readonly content: { readonly sha: string } } }>;
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

interface GitHubReleaseWavePublisherSnapshotAckAdapterInput {
  readonly branch: string;
  readonly client: GitHubFileContentsClient;
  readonly owner: string;
  readonly repository: string;
}

/*** Persist request-bound pre-publish acknowledgements with GitHub Contents compare-and-swap. */
export function GitHubReleaseWavePublisherSnapshotAckAdapter(
  input: GitHubReleaseWavePublisherSnapshotAckAdapterInput,
): ReleaseWavePublisherSnapshotAckPort {
  return {
    loadReleaseWavePublisherSnapshotAckAsync: (requestId) => loadAckAsync(input, requestId),
    saveReleaseWavePublisherSnapshotAckAsync: (ack) => saveAckAsync(input, ack),
  };
}

/*** Read one acknowledgement from its traversal-safe durable request identity. */
async function loadAckAsync(
  input: GitHubReleaseWavePublisherSnapshotAckAdapterInput,
  requestId: string,
): Promise<ReleaseWavePublisherSnapshotAck | undefined> {
  try {
    const response = await input.client.repos.getContent({
      owner: input.owner,
      path: ackPath(requestId),
      ref: input.branch,
      repo: input.repository,
    });
    return parseAckContent(response.data);
  } catch (error) {
    if (githubFailureStatus(error) === 404) return undefined;
    throw error;
  }
}

/*** Create an acknowledgement only after its epoch is still present and bound to the same evidence. */
async function saveAckAsync(
  input: GitHubReleaseWavePublisherSnapshotAckAdapterInput,
  ack: ReleaseWavePublisherSnapshotAck,
): Promise<ReleaseWavePublisherSnapshotAck> {
  const recovered = await loadAckAsync(input, ack.requestId);
  if (recovered !== undefined) return sameAck(recovered, ack) ? recovered : rejectConflict();
  await assertPersistedEpochAsync(input, ack);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await loadAckAsync(input, ack.requestId);
    if (existing !== undefined) return sameAck(existing, ack) ? existing : rejectConflict();
    try {
      await input.client.repos.createOrUpdateFileContents({
        branch: input.branch,
        content: Buffer.from(JSON.stringify(ack) + '\n').toString('base64'),
        message: 'chore(release-wave): acknowledge publisher snapshot ' + ack.requestId,
        owner: input.owner,
        path: ackPath(ack.requestId),
        repo: input.repository,
      });
      return ack;
    } catch (error) {
      if (![409, 422].includes(githubFailureStatus(error) ?? 0)) throw error;
    }
  }
  const afterConflict = await loadAckAsync(input, ack.requestId);
  if (afterConflict !== undefined && sameAck(afterConflict, ack)) return afterConflict;
  throw new Error('Release-wave publisher snapshot acknowledgement CAS conflict.');
}

/*** Verify the epoch document independently so an ACK never names an unpersisted or unrelated epoch. */
async function assertPersistedEpochAsync(
  input: GitHubReleaseWavePublisherSnapshotAckAdapterInput,
  ack: ReleaseWavePublisherSnapshotAck,
): Promise<void> {
  const response = await input.client.repos.getContent({
    owner: input.owner,
    path: '.github/release-wave-publisher-epochs.json',
    ref: input.branch,
    repo: input.repository,
  });
  const document = parseJsonContent(response.data);
  const epochs = isRecord(document) && Array.isArray(document.epochs) ? document.epochs : undefined;
  const epoch: unknown = epochs?.find(
    (candidate: unknown) => isRecord(candidate) && candidate.id === ack.epochId,
  );
  const publisher: unknown =
    isRecord(epoch) && Array.isArray(epoch.publishers)
      ? epoch.publishers.find(
          (candidate: unknown) =>
            isRecord(candidate) && candidate.sourceRepository === ack.sourceRepository,
        )
      : undefined;
  if (
    !isRecord(publisher) ||
    publisher.planRevision !== ack.sourceSha ||
    publisher.planStatusHash !== ack.changesetsStatusHash
  )
    throw new Error(
      'Release-wave publisher snapshot acknowledgement epoch is not durably verifiable.',
    );
}

/*** Decode only the one canonical JSON ACK contract consumed by publisher workflows. */
function parseAckContent(content: {
  readonly content: string;
  readonly encoding: string;
  readonly type: string;
}): ReleaseWavePublisherSnapshotAck {
  return parseAck(parseJsonContent(content));
}

/*** Reject malformed or non-file state rather than interpreting provider errors as absent requests. */
function parseJsonContent(content: {
  readonly content: string;
  readonly encoding: string;
  readonly type: string;
}): unknown {
  if (content.type !== 'file' || content.encoding !== 'base64')
    throw new Error('Release-wave publisher snapshot state is not a base64 GitHub file.');
  return JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')) as unknown;
}

/*** Validate the persisted wire contract before it becomes a publisher release gate. */
function parseAck(value: unknown): ReleaseWavePublisherSnapshotAck {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9._:-]{16,200}$/.test(value.requestId) ||
    typeof value.sourceRepository !== 'string' ||
    !/^ankhorage\/[a-z0-9-]+$/.test(value.sourceRepository) ||
    typeof value.sourceSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.sourceSha) ||
    typeof value.changesetsStatusHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.changesetsStatusHash) ||
    typeof value.epochId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.epochId)
  )
    throw new Error('Release-wave publisher snapshot acknowledgement is malformed.');
  return {
    changesetsStatusHash: value.changesetsStatusHash,
    epochId: value.epochId,
    requestId: value.requestId,
    sourceRepository: value.sourceRepository,
    sourceSha: value.sourceSha,
  };
}

/*** Preserve immutable idempotency: a request identity can never change its evidence or epoch. */
function sameAck(
  left: ReleaseWavePublisherSnapshotAck,
  right: ReleaseWavePublisherSnapshotAck,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/*** Use request IDs only as immutable idempotency keys. */
function rejectConflict(): never {
  throw new Error(
    'Release-wave publisher snapshot request id was replayed with different evidence.',
  );
}

/*** Keep file paths disjoint per request and reject path traversal before any GitHub call. */
function ackPath(requestId: string): string {
  if (!/^[A-Za-z0-9._:-]{16,200}$/.test(requestId))
    throw new Error('Release-wave publisher snapshot request identifier is invalid.');
  return '.github/release-wave-publisher-snapshot-acks/' + requestId + '.json';
}

/*** Read HTTP-style provider failures without coupling the port to a particular GitHub SDK. */
function githubFailureStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
}

/*** Narrow untrusted provider JSON without unsafe casts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
