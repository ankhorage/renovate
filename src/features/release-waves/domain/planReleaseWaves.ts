import { gte, valid, validRange } from 'semver';

import type {
  DependencyKind,
  PublishedPackage,
  ReleaseWaveLedger,
  ReleaseWaveNode,
  ReleaseWavePlan,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/*** Build a deterministic, fail-closed release plan from the selected App installation inventory. */
export function planReleaseWaves(
  repositories: readonly ReleaseWaveRepository[],
  publishedPackages: readonly PublishedPackage[],
  runId: string,
): ReleaseWavePlan {
  const publishedByName = new Map(publishedPackages.map((item) => [item.name, item]));
  const classified = [...repositories].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
  const pendingBootstrap = classified.filter(isPendingBootstrap).map((item) => item.fullName);
  const excluded = classified.flatMap(classifyIntentionalExclusion);
  const eligibility = new Map(
    classified.map((item) => [item.fullName, classifyEligibility(item, publishedByName)]),
  );
  const eligible = classified.filter(
    (item) => isEligible(item) && eligibility.get(item.fullName) === undefined,
  );
  const selectedProviders = new Map(
    classified.flatMap((item) =>
      item.packageName === undefined ? [] : [[item.packageName, item] as const],
    ),
  );
  const readyProviders = new Map(
    eligible.flatMap((item) =>
      item.packageName === undefined ? [] : [[item.packageName, item] as const],
    ),
  );
  const nodeResults = eligible.map((item) =>
    createReleaseWaveNode(item, selectedProviders, readyProviders, publishedByName, eligibility),
  );
  const nodes = nodeResults.filter((result): result is ReleaseWaveNode => !Array.isArray(result));
  const graphProblems = nodeResults.filter(isProblemList).flat();
  const cycleProblems = findCycleProblems(nodes);
  const blocked = [...eligibility.values(), ...graphProblems, ...cycleProblems]
    .filter((entry): entry is string => entry !== undefined)
    .sort();

  return {
    blocked,
    excluded,
    nodes,
    pendingBootstrap,
    runId,
    waves: cycleProblems.length === 0 ? createWaves(nodes) : [],
  };
}

/*** Partition a deterministic wave into bounded concurrent execution batches. */
export function partitionReleaseWave(
  repositories: readonly string[],
  maximumConcurrency: number,
): readonly (readonly string[])[] {
  if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1) {
    throw new Error('Release-wave concurrency must be a positive integer.');
  }
  const ordered = [...repositories].sort();
  return Array.from({ length: Math.ceil(ordered.length / maximumConcurrency) }, (_, index) =>
    ordered.slice(index * maximumConcurrency, (index + 1) * maximumConcurrency),
  );
}

/*** Merge checkpoint transitions idempotently without permitting terminal releases to regress. */
export function mergeReleaseWaveLedger(
  ledger: ReleaseWaveLedger,
  repository: string,
  status: ReleaseWaveLedger['nodes'][string],
): ReleaseWaveLedger {
  const current = Object.entries(ledger.nodes).find(([name]) => name === repository)?.[1];
  if (current === 'released' || (current === 'verified' && status !== 'released')) return ledger;
  return { ...ledger, nodes: { ...ledger.nodes, [repository]: status } };
}

/*** Identify selected repositories that require the managed workflow before they can participate. */
function isPendingBootstrap(repository: ReleaseWaveRepository): boolean {
  return (
    !repository.archived && repository.excludedReason === undefined && !repository.bootstrapReady
  );
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

/*** Keep intentional inventory profiles visible without allowing them to block unrelated components. */
function classifyIntentionalExclusion(repository: ReleaseWaveRepository): readonly string[] {
  if (repository.archived) return [repository.fullName + ': archived'];
  if (repository.excludedReason !== undefined)
    return [repository.fullName + ': excluded: ' + repository.excludedReason];
  return [];
}

/*** Report only accidental release blockers; profile exclusions remain separate. */
function classifyEligibility(
  repository: ReleaseWaveRepository,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): string | undefined {
  if (classifyIntentionalExclusion(repository).length > 0 || !repository.bootstrapReady)
    return undefined;
  if (repository.packageName === undefined || repository.packageVersion === undefined) {
    return repository.fullName + ': missing publishable package identity';
  }
  if (!requiresNpmPublication(repository)) return undefined;
  const published = publishedByName.get(repository.packageName);
  if (published === undefined)
    return repository.fullName + ': no verified stable published package version';
  if (valid(repository.packageVersion) === null || valid(published.version) === null) {
    return repository.fullName + ': invalid stable package version';
  }
  if (
    repository.plannedPublicationVersion === undefined ||
    valid(repository.plannedPublicationVersion) === null
  )
    return repository.fullName + ': missing authoritative planned publication version';
  return gte(published.version, repository.packageVersion)
    ? undefined
    : repository.fullName +
        ': verified package publication would downgrade ' +
        repository.packageName;
}

/*** Build runtime ordering edges and diagnose unavailable selected upstream providers. */
function createReleaseWaveNode(
  repository: ReleaseWaveRepository,
  selectedProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  eligibility: ReadonlyMap<string, string | undefined>,
): ReleaseWaveNode | readonly string[] {
  const results = [
    ...readRuntimeDependencies(
      repository,
      'dependencies',
      repository.dependencies.dependencies,
      selectedProviders,
      readyProviders,
      publishedByName,
      eligibility,
    ),
    ...readRuntimeDependencies(
      repository,
      'optionalDependencies',
      repository.dependencies.optionalDependencies,
      selectedProviders,
      readyProviders,
      publishedByName,
      eligibility,
    ),
  ];
  const peerProblems = Object.entries(repository.dependencies.peerDependencies).flatMap(
    ([packageName, declaration]) =>
      isValidUpdateRange(declaration)
        ? []
        : [repository.fullName + ': invalid peerDependencies ' + packageName + '@' + declaration],
  );
  const problems = [...peerProblems, ...results.filter(isProblem)].sort();
  if (problems.length > 0) return problems;
  if (repository.packageName === undefined) return [repository.fullName + ': missing package name'];
  const expectedPublication = publicationExpectation(repository);
  return {
    dependencies: results.filter(isDependency).sort(),
    expectedPublication,
    packageName: repository.packageName,
    requiresNpmPublication: requiresNpmPublication(repository),
    repository: repository.fullName,
  };
}

/** Keep the plan's publishable-node evidence complete after eligibility has accepted it. */
function publicationExpectation(repository: ReleaseWaveRepository) {
  if (!requiresNpmPublication(repository)) return undefined;
  if (repository.plannedPublicationVersion === undefined)
    throw new Error('Release-wave publishable node is missing its planned publication version.');
  return { version: repository.plannedPublicationVersion };
}

/*** Read one runtime dependency section without promoting build tooling to a release prerequisite. */
function readRuntimeDependencies(
  repository: ReleaseWaveRepository,
  kind: DependencyKind,
  dependencies: Readonly<Record<string, string>>,
  selectedProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  eligibility: ReadonlyMap<string, string | undefined>,
): readonly string[] {
  return Object.entries(dependencies).map(([packageName, declaration]) =>
    readRuntimeDependency(
      repository,
      kind,
      packageName,
      declaration,
      selectedProviders,
      readyProviders,
      publishedByName,
      eligibility,
    ),
  );
}

/*** Validate an update declaration while preserving the existing range as a starting point, not a ceiling. */
function readRuntimeDependency(
  repository: ReleaseWaveRepository,
  kind: DependencyKind,
  packageName: string,
  declaration: string,
  selectedProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  readyProviders: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
  eligibility: ReadonlyMap<string, string | undefined>,
): string {
  if (!isValidUpdateRange(declaration)) {
    return repository.fullName + ': invalid ' + kind + ' ' + packageName + '@' + declaration;
  }
  if (!packageName.startsWith('@ankhorage/')) return '';
  const selected = selectedProviders.get(packageName);
  if (selected === undefined) {
    return publishedByName.has(packageName)
      ? ''
      : repository.fullName + ': unresolved external provider ' + packageName;
  }
  const provider = readyProviders.get(packageName);
  if (provider === undefined) {
    const reason = eligibility.get(selected.fullName) ?? profileReason(selected);
    return repository.fullName + ': blocked provider ' + packageName + ' (' + reason + ')';
  }
  return provider.fullName;
}

/*** Keep nonpublished applications in coordinated verification while excluding only npm publication. */
function requiresNpmPublication(repository: ReleaseWaveRepository): boolean {
  return repository.publishable && !repository.private;
}

/*** Keep semver parsing authoritative for compound ranges while rejecting tags and non-semver declarations. */
function isValidUpdateRange(declaration: string): boolean {
  return validRange(declaration) !== null;
}

/*** Render an unavailable provider profile in a deterministic diagnostic. */
function profileReason(repository: ReleaseWaveRepository): string {
  if (!repository.bootstrapReady) return 'pending-bootstrap';
  return classifyIntentionalExclusion(repository)[0] ?? 'unavailable';
}

/*** Create waves only after every runtime upstream node settled in an earlier wave. */
function createWaves(nodes: readonly ReleaseWaveNode[]): readonly (readonly string[])[] {
  const remaining = new Map(nodes.map((node) => [node.repository, new Set(node.dependencies)]));
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([repository]) => repository)
      .sort();
    if (wave.length === 0) return [];
    waves.push(wave);
    for (const repository of wave) remaining.delete(repository);
    for (const dependencies of remaining.values()) {
      for (const repository of wave) dependencies.delete(repository);
    }
  }
  return waves;
}

/*** Surface a deterministic diagnostic when runtime release prerequisites form a cycle. */
function findCycleProblems(nodes: readonly ReleaseWaveNode[]): readonly string[] {
  return createWaves(nodes).length === 0 && nodes.length > 0
    ? [
        'release dependency cycle: ' +
          nodes
            .map((node) => node.repository)
            .sort()
            .join(', '),
      ]
    : [];
}

/*** Narrow graph results to diagnostics. */
function isProblemList(result: ReleaseWaveNode | readonly string[]): result is readonly string[] {
  return Array.isArray(result);
}

/*** Distinguish a diagnostic from a repository dependency edge. */
function isProblem(value: string): boolean {
  return value.includes(': ');
}

/*** Exclude empty external dependencies from graph edges. */
function isDependency(value: string): boolean {
  return value !== '' && !isProblem(value);
}
