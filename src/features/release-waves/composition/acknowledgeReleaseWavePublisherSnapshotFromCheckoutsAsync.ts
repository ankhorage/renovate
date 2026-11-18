import type { ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { changesetReleaseDecisionsAsync } from '../adapters/changesets/changesetReleasePlansAsync.js';
import { acquireGitHubReleaseWaveCheckoutsAsync } from '../adapters/github/acquireGitHubReleaseWaveCheckoutsAsync.js';
import { acknowledgeReleaseWavePublisherSnapshotAsync } from '../application/acknowledgeReleaseWavePublisherSnapshotAsync.js';
import type { ReleaseWavePublisherEpochWriterPort } from '../ports/releaseWavePublisherEpoch.js';
import type {
  ReleaseWavePublisherSnapshotAckPort,
  ReleaseWavePublisherSnapshotRequest,
} from '../ports/releaseWavePublisherSnapshot.js';

/*** Derive complete immutable Changesets evidence and persist the request-bound pre-publish acknowledgement. */
export async function acknowledgeReleaseWavePublisherSnapshotFromCheckoutsAsync(input: {
  readonly ackPort: ReleaseWavePublisherSnapshotAckPort;
  readonly inventoryId: string;
  readonly publisherEpochWriterPort: ReleaseWavePublisherEpochWriterPort;
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly request: ReleaseWavePublisherSnapshotRequest;
  readonly token: string;
}) {
  return acquireGitHubReleaseWaveCheckoutsAsync({
    repositories: input.repositories,
    token: input.token,
    useAsync: async (checkouts) =>
      acknowledgeReleaseWavePublisherSnapshotAsync({
        ackPort: input.ackPort,
        inventoryId: input.inventoryId,
        publicationDecisions: await changesetReleaseDecisionsAsync(checkouts),
        publisherEpochWriterPort: input.publisherEpochWriterPort,
        repositories: input.repositories,
        request: input.request,
      }),
  });
}
