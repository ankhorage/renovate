import type {
  PublishedPackage,
  ReleaseWaveDependency,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/** Bind every direct Ankhorage runtime update to its planned or already-published version. */
export function expectedReleaseWaveDependencies(
  repository: ReleaseWaveRepository,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): readonly ReleaseWaveDependency[] {
  return [
    ...Object.keys(repository.dependencies.dependencies),
    ...Object.keys(repository.dependencies.optionalDependencies),
  ]
    .filter((packageName) => packageName.startsWith('@ankhorage/'))
    .map((packageName) => expectedDependency(packageName, readyProviders, publishedByName))
    .filter((dependency): dependency is ReleaseWaveDependency => dependency !== undefined)
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
}

/** Prefer a selected provider's immutable Changesets target over its current registry version. */
function expectedDependency(
  packageName: string,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): ReleaseWaveDependency | undefined {
  const provider = readyProviders.get(packageName);
  const version =
    provider?.plannedPublication?.version ?? publishedByName.get(packageName)?.version;
  return version === undefined ? undefined : { packageName, version };
}
