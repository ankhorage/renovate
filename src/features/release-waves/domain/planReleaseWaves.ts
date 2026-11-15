import type {
  DependencyKind,
  PublishedPackage,
  ReleaseWaveLedger,
  ReleaseWaveNode,
  ReleaseWavePlan,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

const orderingDependencyKinds: readonly DependencyKind[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
];

/*** Build a deterministic, fail-closed release plan from the selected App installation inventory. */
export function planReleaseWaves(
  repositories: readonly ReleaseWaveRepository[],
  publishedPackages: readonly PublishedPackage[],
  runId: string,
): ReleaseWavePlan {
  const publishedByName = new Map(
    publishedPackages.map((publishedPackage) => [publishedPackage.name, publishedPackage]),
  );
  const classified = [...repositories].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
  const pendingBootstrap = classified
    .filter((repository) => isPendingBootstrap(repository))
    .map((repository) => repository.fullName);
  const blocked = classified.flatMap((repository) =>
    classifyBlockedRepository(repository, publishedByName),
  );
  const eligible = classified.filter((repository) => isEligible(repository));
  const packagesByName = new Map<string, ReleaseWaveRepository>(
    eligible
      .filter(
        (repository): repository is ReleaseWaveRepository & { readonly packageName: string } =>
          repository.packageName !== undefined,
      )
      .map((repository) => [repository.packageName, repository]),
  );
  const nodeResults = eligible.map((repository) =>
    createReleaseWaveNode(repository, packagesByName, publishedByName),
  );
  const nodes = nodeResults.filter((result): result is ReleaseWaveNode => !Array.isArray(result));
  const graphProblems = nodeResults.filter(isProblemList).flat();
  const cycleProblems = findCycleProblems(nodes);
  const allBlocked = [...blocked, ...graphProblems, ...cycleProblems].sort();

  return {
    blocked: allBlocked,
    nodes,
    pendingBootstrap,
    runId,
    waves: allBlocked.length === 0 ? createWaves(nodes) : [],
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

/*** Merge terminal release evidence idempotently so retried events cannot create another release. */
export function mergeReleaseWaveLedger(
  ledger: ReleaseWaveLedger,
  repository: string,
  status: ReleaseWaveLedger['nodes'][string],
): ReleaseWaveLedger {
  const current = new Map(Object.entries(ledger.nodes)).get(repository);
  if (current === 'released' && status !== 'released') return ledger;
  return {
    ...ledger,
    nodes: { ...ledger.nodes, [repository]: status },
  };
}

/*** Identify selected repositories that remain visible but cannot run until their managed workflow is bootstrapped. */
function isPendingBootstrap(repository: ReleaseWaveRepository): boolean {
  return (
    !repository.archived && repository.excludedReason === undefined && !repository.bootstrapReady
  );
}

/*** Accept only installation-selected, active, bootstrapped publishable package repositories into a release wave. */
function isEligible(repository: ReleaseWaveRepository): boolean {
  return (
    !repository.archived &&
    repository.excludedReason === undefined &&
    repository.bootstrapReady &&
    repository.publishable &&
    !repository.private &&
    repository.packageName !== undefined &&
    repository.packageVersion !== undefined
  );
}

/*** Report terminal classifications that must be visible in the release ledger rather than silently skipped. */
function classifyBlockedRepository(
  repository: ReleaseWaveRepository,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): readonly string[] {
  if (repository.archived) return [repository.fullName + ': archived'];
  if (repository.excludedReason !== undefined)
    return [repository.fullName + ': excluded: ' + repository.excludedReason];
  if (!repository.bootstrapReady) return [];
  if (repository.private) return [repository.fullName + ': private'];
  if (!repository.publishable) return [repository.fullName + ': non-publishable'];
  if (repository.packageName === undefined || repository.packageVersion === undefined) {
    return [repository.fullName + ': missing publishable package identity'];
  }
  const published = publishedByName.get(repository.packageName);
  if (published === undefined) {
    return [repository.fullName + ': no verified stable published package version'];
  }
  return [];
}

/*** Build one node and validate all ordering and peer contracts against verified stable publications. */
function createReleaseWaveNode(
  repository: ReleaseWaveRepository,
  packagesByName: ReadonlyMap<string, ReleaseWaveRepository>,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): ReleaseWaveNode | readonly string[] {
  const dependenciesByKind = new Map(Object.entries(repository.dependencies));
  const orderingDependencies = orderingDependencyKinds.flatMap((kind) =>
    Object.entries(dependenciesByKind.get(kind) ?? {}).flatMap(([packageName, declaration]) => {
      const provider = packagesByName.get(packageName);
      if (provider === undefined) return [];
      const published = publishedByName.get(packageName);
      if (published === undefined || !isCompatibleVersion(declaration, published.version)) {
        return [
          repository.fullName + ': incompatible ' + kind + ' ' + packageName + '@' + declaration,
        ];
      }
      return [provider.fullName];
    }),
  );
  const peerProblems = findPeerProblems(repository, publishedByName);
  if (
    peerProblems.length > 0 ||
    orderingDependencies.some((dependency) => dependency.includes(': incompatible '))
  ) {
    return [
      ...peerProblems,
      ...orderingDependencies.filter((dependency) => dependency.includes(': incompatible ')),
    ];
  }
  if (repository.packageName === undefined) return [repository.fullName + ': missing package name'];
  return {
    dependencies: orderingDependencies
      .filter((dependency) => !dependency.includes(': incompatible '))
      .sort(),
    packageName: repository.packageName,
    repository: repository.fullName,
  };
}

/*** Return diagnostics for peer ranges that do not support their verified stable package release. */
function findPeerProblems(
  repository: ReleaseWaveRepository,
  publishedByName: ReadonlyMap<string, PublishedPackage>,
): readonly string[] {
  return Object.entries(repository.dependencies.peerDependencies).flatMap(
    ([packageName, declaration]) => {
      const published = publishedByName.get(packageName);
      return published === undefined || !isCompatibleVersion(declaration, published.version)
        ? [
            repository.fullName +
              ': incompatible peerDependencies ' +
              packageName +
              '@' +
              declaration,
          ]
        : [];
    },
  );
}

/*** Create waves only after every upstream node has settled in an earlier wave. */
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

/*** Surface a deterministic diagnostic when ordering dependencies form a real release cycle. */
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

/*** Narrow a release-wave result to its explicit diagnostics. */
function isProblemList(result: ReleaseWaveNode | readonly string[]): result is readonly string[] {
  return Array.isArray(result);
}

/*** Verify the supported stable declaration forms without accepting a downgrade or prerelease as a settled release. */
function isCompatibleVersion(declaration: string, version: string): boolean {
  const selected = parseStableVersion(version);
  const match = /^(?<operator>\^|~)?(?<declared>\d+\.\d+\.\d+)$/u.exec(declaration);
  const declared =
    match?.groups?.declared === undefined ? undefined : parseStableVersion(match.groups.declared);
  if (selected === undefined || declared === undefined) return false;
  if (compareVersions(selected, declared) < 0) return false;
  if (match?.groups?.operator === undefined) return compareVersions(selected, declared) === 0;
  if (match.groups.operator === '~')
    return selected[0] === declared[0] && selected[1] === declared[1];
  return isCaretCompatible(declared, selected);
}

/*** Check the compatible-major semantics of a stable caret range. */
function isCaretCompatible(
  declared: readonly [number, number, number],
  selected: readonly [number, number, number],
): boolean {
  if (declared[0] !== 0) return selected[0] === declared[0];
  if (declared[1] !== 0) return selected[0] === 0 && selected[1] === declared[1];
  return selected[0] === 0 && selected[1] === 0 && selected[2] === declared[2];
}

/*** Parse an exact stable semantic version. */
function parseStableVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/*** Compare semantic-version triples. */
function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  const [leftMajor, leftMinor, leftPatch] = left;
  const [rightMajor, rightMinor, rightPatch] = right;
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}
