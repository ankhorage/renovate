import type {
  PublishedPackage,
  ReleaseWaveCheckout,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';
import { changesetReleasePlansAsync } from '../adapters/changesets/changesetReleasePlansAsync.js';
import { planReleaseWaves } from '../domain/planReleaseWaves.js';

/*** Compose immutable Changesets collection with deterministic release-wave planning. */
export async function planReleaseWavesFromCheckoutsAsync(input: {
  readonly checkouts: Readonly<Record<string, ReleaseWaveCheckout>>;
  readonly publishedPackages: readonly PublishedPackage[];
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly runId: string;
}) {
  return planReleaseWaves(
    input.repositories,
    input.publishedPackages,
    input.runId,
    await changesetReleasePlansAsync(input.checkouts),
  );
}
