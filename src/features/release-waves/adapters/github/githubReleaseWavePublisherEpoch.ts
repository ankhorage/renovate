import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';
import type { DurableReleaseWaveEvent } from '../../ports/releaseWaveEventQueue.js';
import type {
  ReleaseWavePublisherEpoch,
  ReleaseWaveScheduledPublisher,
} from '../../ports/releaseWavePublicationCohort.js';
import type { ReleaseWavePublisherEpochPort } from '../../ports/releaseWavePublisherEpoch.js';

/*** Select a complete durable epoch without allowing one blocked branch to prevent an unrelated cohort. */
export async function githubReleaseWavePublisherEpochAsync(input: {
  readonly pendingEvents: readonly DurableReleaseWaveEvent[];
  readonly publisherEpochPort: ReleaseWavePublisherEpochPort;
  readonly repositories: readonly ReleaseWaveRepository[];
}): Promise<
  | {
      readonly epoch: ReleaseWavePublisherEpoch;
      readonly events: readonly DurableReleaseWaveEvent[];
    }
  | undefined
> {
  const epochs = await input.publisherEpochPort.loadReleaseWavePublisherEpochsAsync();
  for (const epoch of [...epochs].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!isCurrentSelectedEpoch(epoch, input.repositories)) continue;
    const events = epochEvents(input.pendingEvents, epoch.publishers);
    if (events !== undefined) return { epoch, events };
  }
  return undefined;
}

/*** Admit frozen publisher evidence only while every publisher is still positively selected by the App. */
function isCurrentSelectedEpoch(
  epoch: ReleaseWavePublisherEpoch,
  repositories: readonly ReleaseWaveRepository[],
): boolean {
  if (!/^[a-f0-9]{64}$/.test(epoch.inventoryId) || !/^[a-f0-9]{40}$/.test(epoch.sourceRevision))
    throw new Error('Release-wave publisher epoch has invalid immutable evidence.');
  const selected = new Map(repositories.map((repository) => [repository.fullName, repository]));
  if (selected.size !== repositories.length)
    throw new Error('Selected installation has duplicate repositories.');
  return epoch.publishers.every((publisher) => {
    const repository = selected.get(publisher.sourceRepository);
    return (
      repository !== undefined &&
      !repository.archived &&
      repository.excludedReason === undefined &&
      repository.bootstrapReady &&
      repository.publishable &&
      !repository.private &&
      repository.packageName === publisher.packageName &&
      repository.packageVersion === publisher.version
    );
  });
}

/*** Match exact scheduled publisher identities, refusing duplicate or superseding event evidence. */
function epochEvents(
  events: readonly DurableReleaseWaveEvent[],
  publishers: readonly ReleaseWaveScheduledPublisher[],
): readonly DurableReleaseWaveEvent[] | undefined {
  const expected = new Map(
    publishers.map((publisher) => [
      publisher.packageName,
      publisher.sourceRepository + '\n' + publisher.version,
    ]),
  );
  if (expected.size === 0 || expected.size !== publishers.length)
    throw new Error('Release-wave publisher epoch is empty or has duplicate packages.');
  const matching = events.filter(
    (event) => expected.get(event.packageName) === event.sourceRepository + '\n' + event.version,
  );
  return matching.length === expected.size &&
    new Set(matching.map((event) => event.packageName)).size === expected.size
    ? matching
    : undefined;
}
