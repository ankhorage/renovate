import type { ReleaseWaveEvent } from './releaseWaveEventQueue.js';

/** Original package-release dispatch contract emitted by package publishers. */
interface PackageReleaseDispatch {
  readonly package_name: string;
  readonly source_repository: string;
  readonly version: string;
}

/** Verify immutable GitHub and npm publication facts before durable event admission. */
export interface ReleaseWavePublicationEvidencePort {
  enrichPackageReleaseAsync(input: PackageReleaseDispatch): Promise<ReleaseWaveEvent>;
}
