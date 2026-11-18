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
  /** Immutable release-plan epoch that authoritatively names the publishers expected to settle. */
  readonly epoch: ReleaseWavePublisherEpoch;
  readonly publications: readonly SettledReleaseWavePublication[];
  readonly repositories: readonly ReleaseWaveRepository[];
}

/** A provider-issued schedule, independent of webhook arrival order, for one release wave. */
export interface ReleaseWavePublisherEpoch {
  /** Durable immutable release-plan identity. */
  readonly id: string;
  /** Digest of the selected installation identities and immutable graph inputs. */
  readonly inventoryId: string;
  /** Exact package identities that must provide verified publication evidence before execution. */
  readonly publishers: readonly ReleaseWaveScheduledPublisher[];
}

/** A planned publisher identity; stable dependencies deliberately do not occur here. */
export interface ReleaseWaveScheduledPublisher {
  readonly packageName: string;
  readonly sourceRepository: string;
  readonly version: string;
}

/** Discover a complete publisher cohort from selected installation inventory and provider evidence. */
export interface ReleaseWavePublicationCohortPort {
  collectReleaseWavePublicationCohortAsync(input: {
    readonly pendingEvents: readonly DurableReleaseWaveEvent[];
  }): Promise<ReleaseWavePublicationCohort | undefined>;
}
