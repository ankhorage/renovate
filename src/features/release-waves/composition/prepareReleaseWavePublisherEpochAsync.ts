import type { ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { acquireGitHubReleaseWaveCheckoutsAsync } from '../adapters/github/acquireGitHubReleaseWaveCheckoutsAsync.js';
import type { ReleaseWavePublisherEpochWriterPort } from '../ports/releaseWavePublisherEpoch.js';
import { adoptReleaseWavePublisherEpochFromCheckoutsAsync } from './adoptReleaseWavePublisherEpochFromCheckoutsAsync.js';

/*** Freeze the complete publisher epoch before Changesets versioning consumes its immutable intent. */
export async function prepareReleaseWavePublisherEpochAsync(input: {
  readonly inventoryId: string;
  readonly publisherEpochWriterPort: ReleaseWavePublisherEpochWriterPort;
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly token: string;
}) {
  return acquireGitHubReleaseWaveCheckoutsAsync({
    repositories: input.repositories,
    token: input.token,
    useAsync: (checkouts) =>
      adoptReleaseWavePublisherEpochFromCheckoutsAsync({
        checkouts,
        inventoryId: input.inventoryId,
        publisherEpochWriterPort: input.publisherEpochWriterPort,
        repositories: input.repositories,
      }),
  });
}
