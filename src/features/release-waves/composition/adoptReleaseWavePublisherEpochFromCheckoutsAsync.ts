import type { ReleaseWaveCheckout, ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { changesetReleaseDecisionsAsync } from '../adapters/changesets/changesetReleasePlansAsync.js';
import type { ReleaseWavePublisherEpochWriterPort } from '../ports/releaseWavePublisherEpoch.js';

/*** Collect every eligible selected source decision before atomically adopting its publisher epoch. */
export async function adoptReleaseWavePublisherEpochFromCheckoutsAsync(input: {
  readonly checkouts: Readonly<Record<string, ReleaseWaveCheckout>>;
  readonly inventoryId: string;
  readonly publisherEpochWriterPort: ReleaseWavePublisherEpochWriterPort;
  readonly repositories: readonly ReleaseWaveRepository[];
}) {
  assertCompletePinnedCheckouts(input.repositories, input.checkouts);
  return input.publisherEpochWriterPort.adoptReleaseWavePublisherEpochAsync({
    inventoryId: input.inventoryId,
    publicationDecisions: await changesetReleaseDecisionsAsync(input.checkouts),
    repositories: input.repositories,
  });
}

/*** Require exactly one source-revision-pinned checkout for every eligible selected publisher. */
function assertCompletePinnedCheckouts(
  repositories: readonly ReleaseWaveRepository[],
  checkouts: Readonly<Record<string, ReleaseWaveCheckout>>,
): void {
  const eligible = repositories.filter((repository) => repository.publishable);
  const expected = new Set(eligible.map((repository) => repository.fullName));
  const actual = Object.keys(checkouts);
  if (
    expected.size === 0 ||
    actual.length !== expected.size ||
    actual.some((name) => !expected.has(name))
  )
    throw new Error('Release-wave publisher checkout collection is incomplete.');
  for (const repository of eligible) {
    if (checkouts[repository.fullName]?.revision !== repository.sourceRevision)
      throw new Error(
        'Release-wave publisher checkout is not pinned to the selected source revision.',
      );
  }
}
