import type {
  ChangesetReleasePlan,
  PublishedPackage,
  ReleaseWaveDependency,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/** Bind every direct Ankhorage update to its planned or already-published version. */
export function expectedReleaseWaveDependencies(
  repository: ReleaseWaveRepository,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>,
): readonly ReleaseWaveDependency[] {
  return [
    ...Object.keys(repository.dependencies.dependencies),
    ...Object.keys(repository.dependencies.devDependencies),
    ...Object.keys(repository.dependencies.optionalDependencies),
  ]
    .filter((packageName) => packageName.startsWith('@ankhorage/'))
    .map((packageName) =>
      expectedDependency(packageName, readyProviders, publishedByName, publicationPlans),
    )
    .filter((dependency): dependency is ReleaseWaveDependency => dependency !== undefined)
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
}

/** Prefer a selected provider's immutable Changesets target over its current registry version. */
function expectedDependency(
  packageName: string,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>,
): ReleaseWaveDependency | undefined {
  const provider = readyProviders.get(packageName);
  const version =
    (provider === undefined ? undefined : publicationPlans.get(provider.fullName)?.version) ??
    publishedByName.get(packageName)?.version;
  return version === undefined ? undefined : { packageName, version };
}
