import { gte, valid } from 'semver';

import type {
  ChangesetReleasePlan,
  PublishedPackage,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/*** Classify the immutable repository inventory before graph planning. */
export function releaseWavePlanningContext(
  repositories: readonly ReleaseWaveRepository[],
  publishedPackages: readonly PublishedPackage[],
  publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>,
) {
  const classified = [...repositories].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
  const publishedByName = new Map(publishedPackages.map((item) => [item.name, item]));
  const eligibility = new Map(
    classified.map((item) => [
      item.fullName,
      eligibilityProblem(item, publishedByName, publicationPlans),
    ]),
  );
  const eligible = classified.filter(
    (item) => isEligible(item) && eligibility.get(item.fullName) === undefined,
  );
  return { classified, eligibility, eligible, publishedByName };
}

/*** Accept active, bootstrapped packages and applications with a complete update identity into a wave. */
function isEligible(repository: ReleaseWaveRepository): boolean {
  return (
    !repository.archived &&
    repository.excludedReason === undefined &&
    repository.bootstrapReady &&
    repository.packageName !== undefined &&
    repository.packageVersion !== undefined
  );
}

/*** Report only accidental release blockers; profile exclusions remain separate. */
function eligibilityProblem(
  repository: ReleaseWaveRepository,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>,
): string | undefined {
  if (repository.archived || repository.excludedReason !== undefined || !repository.bootstrapReady)
    return undefined;
  if (repository.packageName === undefined || repository.packageVersion === undefined)
    return repository.fullName + ': missing publishable package identity';
  if (!repository.publishable || repository.private) return undefined;
  const published = publishedByName.get(repository.packageName);
  if (published === undefined)
    return repository.fullName + ': no verified stable published package version';
  const plan = publicationPlans.get(repository.fullName);
  if (plan !== undefined && !hasCanonicalPlan(repository, published, plan))
    return repository.fullName + ': missing canonical Changesets publication plan';
  return gte(published.version, repository.packageVersion)
    ? undefined
    : repository.fullName +
        ': verified package publication would downgrade ' +
        repository.packageName;
}

/*** Validate the managed Changesets decision without trusting inventory metadata. */
function hasCanonicalPlan(
  repository: ReleaseWaveRepository,
  published: PublishedPackage,
  plan: ChangesetReleasePlan | undefined,
): boolean {
  return (
    valid(repository.packageVersion) !== null &&
    valid(published.version) !== null &&
    plan !== undefined &&
    valid(plan.version) !== null &&
    plan.packageName === repository.packageName &&
    plan.releases.some(
      (release) => release.packageName === repository.packageName && release.type === 'patch',
    )
  );
}
