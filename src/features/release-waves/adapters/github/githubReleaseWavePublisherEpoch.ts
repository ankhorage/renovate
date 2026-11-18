import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';
import type { DurableReleaseWaveEvent } from '../../ports/releaseWaveEventQueue.js';
import type {
  ReleaseWavePublisherEpoch,
  ReleaseWaveScheduledPublisher,
} from '../../ports/releaseWavePublicationCohort.js';

/*** Select a complete durable epoch without allowing one blocked branch to prevent an unrelated cohort. */
export async function githubReleaseWavePublisherEpochAsync(input: {
  readonly inventoryId: string;
  readonly pendingEvents: readonly DurableReleaseWaveEvent[];
  readonly publisherEpochsAsync: (input: {
    readonly inventoryId: string;
    readonly repositories: readonly ReleaseWaveRepository[];
  }) => Promise<readonly ReleaseWavePublisherEpoch[]>;
  readonly repositories: readonly ReleaseWaveRepository[];
}): Promise<
  | {
      readonly epoch: ReleaseWavePublisherEpoch;
      readonly events: readonly DurableReleaseWaveEvent[];
    }
  | undefined
> {
  const epochs = await input.publisherEpochsAsync({
    inventoryId: input.inventoryId,
    repositories: input.repositories,
  });
  for (const epoch of [...epochs].sort((left, right) => left.id.localeCompare(right.id))) {
    if (epoch.inventoryId !== input.inventoryId)
      throw new Error(
        'Release-wave publisher epoch inventory does not match selected installation.',
      );
    const events = epochEvents(input.pendingEvents, epoch.publishers);
    if (events !== undefined) return { epoch, events };
  }
  return undefined;
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
