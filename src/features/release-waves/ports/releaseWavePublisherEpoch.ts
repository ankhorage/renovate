import type {
  ChangesetReleaseDecision,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';
import type { ReleaseWavePublisherEpoch } from './releaseWavePublicationCohort.js';

/** Read immutable publisher schedules from the authoritative release-plan boundary. */
export interface ReleaseWavePublisherEpochPort {
  loadReleaseWavePublisherEpochsAsync(input: {
    readonly inventoryId: string;
    readonly repositories: readonly ReleaseWaveRepository[];
  }): Promise<readonly ReleaseWavePublisherEpoch[]>;
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
