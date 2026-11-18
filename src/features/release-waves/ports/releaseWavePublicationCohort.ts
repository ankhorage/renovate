import type { PublishedPackage, ReleaseWaveRepository } from '../../../types/releaseWave.js';
import type { DurableReleaseWaveEvent } from './releaseWaveEventQueue.js';

/** Immutable GitHub and npm facts for one publisher admitted to a release-wave cohort. */
export interface SettledReleaseWavePublication extends PublishedPackage {
  readonly npmArtifactIntegrity: string;
  readonly releaseId: string;
  readonly releaseTag: string;
  readonly sourceRepository: string;
}

/** An immutable selected-installation snapshot and the exact publishers admitted from it. */
export interface ReleaseWavePublicationCohort {
  readonly publications: readonly SettledReleaseWavePublication[];
  readonly repositories: readonly ReleaseWaveRepository[];
}

/** Discover a complete publisher cohort from selected installation inventory and provider evidence. */
export interface ReleaseWavePublicationCohortPort {
  collectReleaseWavePublicationCohortAsync(input: {
    readonly pendingEvents: readonly DurableReleaseWaveEvent[];
  }): Promise<ReleaseWavePublicationCohort | undefined>;
}
