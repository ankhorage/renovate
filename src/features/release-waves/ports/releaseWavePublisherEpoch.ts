import type {
  ChangesetReleaseDecision,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';
import type { ReleaseWavePublisherEpoch } from './releaseWavePublicationCohort.js';

/** Read immutable publisher schedules from the authoritative release-plan boundary. */
export interface ReleaseWavePublisherEpochPort {
  /**
   * Load every structurally valid immutable epoch. The current App installation decides which
   * epoch remains admissible after its publishers have advanced their mutable default branches.
   */
  loadReleaseWavePublisherEpochsAsync(): Promise<readonly ReleaseWavePublisherEpoch[]>;
}

/** Persist one complete, immutable publisher schedule before any of its releases are consumed. */
export interface ReleaseWavePublisherEpochWriterPort {
  adoptReleaseWavePublisherEpochAsync(input: {
    readonly inventoryId: string;
    /**
     * Exhaustive, clean-checkout Changesets decisions keyed by selected
     * publishable repository.  An unchanged source is present with no plan.
     */
    readonly publicationDecisions: ReadonlyMap<string, ChangesetReleaseDecision>;
    readonly repositories: readonly ReleaseWaveRepository[];
  }): Promise<ReleaseWavePublisherEpoch>;
}
