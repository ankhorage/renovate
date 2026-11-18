import type { ChangesetReleasePlan, ReleaseWaveRepository } from '../../../types/releaseWave.js';
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
    /** Trusted, candidate-scoped Changesets decisions keyed by selected repository. */
    readonly publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>;
    readonly repositories: readonly ReleaseWaveRepository[];
  }): Promise<ReleaseWavePublisherEpoch>;
}
