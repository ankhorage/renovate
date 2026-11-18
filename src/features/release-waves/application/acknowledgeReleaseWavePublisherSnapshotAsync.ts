import type { ReleaseWavePublisherEpochWriterPort } from '../ports/releaseWavePublisherEpoch.js';
import type {
  ReleaseWavePublisherSnapshotAck,
  ReleaseWavePublisherSnapshotAckPort,
  ReleaseWavePublisherSnapshotRequest,
} from '../ports/releaseWavePublisherSnapshot.js';
import type {
  ChangesetReleaseDecision,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/** Persist one complete pre-publish epoch and only then issue its idempotent request-bound acknowledgement. */
export async function acknowledgeReleaseWavePublisherSnapshotAsync(input: {
  readonly ackPort: ReleaseWavePublisherSnapshotAckPort;
  readonly inventoryId: string;
  readonly publicationDecisions: ReadonlyMap<string, ChangesetReleaseDecision>;
  readonly publisherEpochWriterPort: ReleaseWavePublisherEpochWriterPort;
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly request: ReleaseWavePublisherSnapshotRequest;
}): Promise<ReleaseWavePublisherSnapshotAck> {
  validateRequest(input.request);
  const existing = await input.ackPort.loadReleaseWavePublisherSnapshotAckAsync(
    input.request.requestId,
  );
  if (existing !== undefined)
    return sameRequest(existing, input.request) ? existing : rejectReplay();
  const requested = input.repositories.find(
    (repository) => repository.fullName === input.request.sourceRepository,
  );
  if (requested?.sourceRevision !== input.request.sourceSha)
    throw new Error('Release-wave snapshot request source revision is stale or unselected.');
  const decision = input.publicationDecisions.get(input.request.sourceRepository);
  if (decision?.statusHash !== input.request.changesetsStatusHash)
    throw new Error('Release-wave snapshot request Changesets status is stale or incomplete.');
  const epoch = await input.publisherEpochWriterPort.adoptReleaseWavePublisherEpochAsync({
    inventoryId: input.inventoryId,
    publicationDecisions: input.publicationDecisions,
    repositories: input.repositories,
  });
  return input.ackPort.saveReleaseWavePublisherSnapshotAckAsync({
    ...input.request,
    epochId: epoch.id,
  });
}

/** Reject malformed immutable evidence before any installation checkout or CAS write. */
function validateRequest(request: ReleaseWavePublisherSnapshotRequest): void {
  if (
    !/^[A-Za-z0-9._:-]{16,200}$/.test(request.requestId) ||
    !/^ankhorage\/[a-z0-9-]+$/.test(request.sourceRepository) ||
    !/^[a-f0-9]{40}$/.test(request.sourceSha) ||
    !/^[a-f0-9]{64}$/.test(request.changesetsStatusHash)
  )
    throw new Error('Release-wave snapshot request is invalid.');
}

/** Retain idempotency only for the exact immutable request evidence. */
function sameRequest(
  ack: ReleaseWavePublisherSnapshotAck,
  request: ReleaseWavePublisherSnapshotRequest,
): boolean {
  return (
    ack.changesetsStatusHash === request.changesetsStatusHash &&
    ack.sourceRepository === request.sourceRepository &&
    ack.sourceSha === request.sourceSha
  );
}

/** Keep conflicting request-id reuse fail closed. */
function rejectReplay(): never {
  throw new Error('Release-wave snapshot request id was replayed with different evidence.');
}
