import type { ReleaseWaveRepository } from '../../../types/releaseWave.js';
import type { ReleaseWavePublisherEpoch } from './releaseWavePublicationCohort.js';

/** Read immutable publisher schedules from the authoritative release-plan boundary. */
export interface ReleaseWavePublisherEpochPort {
  loadReleaseWavePublisherEpochsAsync(input: {
    readonly inventoryId: string;
    readonly repositories: readonly ReleaseWaveRepository[];
  }): Promise<readonly ReleaseWavePublisherEpoch[]>;
}
