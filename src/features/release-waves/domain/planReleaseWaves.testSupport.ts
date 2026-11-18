import type { ChangesetReleasePlan, ReleaseWaveRepository } from '../../../types/releaseWave.js';
import { planReleaseWaves } from './planReleaseWaves.js';

export const emptyDependencies = {
  dependencies: {},
  devDependencies: {},
  optionalDependencies: {},
  peerDependencies: {},
} as const;

/*** Create a selected, publishable installation repository fixture. */
export function repository(
  fullName: string,
  packageName: string,
  version: string,
  dependencies: ReleaseWaveRepository['dependencies'] = emptyDependencies,
): ReleaseWaveRepository & {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly plannedPublication: ChangesetReleasePlan;
} {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies,
    fullName,
    packageName,
    packageVersion: version,
    plannedPublication: {
      packageName,
      revision: 'a'.repeat(40),
      releases: [{ packageName, type: 'patch' }],
      version: version.replace(/(\d+)$/, (_, patch: string) => String(Number(patch) + 1)),
    },
    private: false,
    publishable: true,
  };
}

/*** Collect fixture Changesets output separately from the inventory under test. */
export function fixturePlan(
  repositories: readonly ReleaseWaveRepository[],
  published: Parameters<typeof planReleaseWaves>[1],
  runId: string,
) {
  const plans = new Map(
    repositories.flatMap((item) => {
      const planned = (
        item as ReleaseWaveRepository & { readonly plannedPublication?: ChangesetReleasePlan }
      ).plannedPublication;
      return planned === undefined ? [] : [[item.fullName, planned] as const];
    }),
  );
  return planReleaseWaves(repositories, published, runId, plans);
}
