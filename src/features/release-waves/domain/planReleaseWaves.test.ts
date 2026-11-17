import { expect, test } from 'bun:test';

import type { ChangesetReleasePlan, ReleaseWaveRepository } from '../../../types/releaseWave.js';
import {
  mergeReleaseWaveLedger,
  partitionReleaseWave,
  planReleaseWaves,
} from './planReleaseWaves.js';

const emptyDependencies = {
  dependencies: {},
  devDependencies: {},
  optionalDependencies: {},
  peerDependencies: {},
} as const;

/*** Create a selected, publishable installation repository fixture. */
function repository(
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
      releases: [{ packageName, type: 'patch' }],
      version: version.replace(/(\d+)$/, (_, patch: string) => String(Number(patch) + 1)),
    },
    private: false,
    publishable: true,
  };
}

/** Collect fixture Changesets output separately from the inventory under test. */
function fixturePlan(
  repositories: readonly ReleaseWaveRepository[],
  published: Parameters<typeof planReleaseWaves>[1],
  runId: string,
) {
  const plans = new Map(
    repositories.flatMap((item) => {
      const planned = (
        item as ReleaseWaveRepository & {
          readonly plannedPublication?: ChangesetReleasePlan;
        }
      ).plannedPublication;
      return planned === undefined ? [] : [[item.fullName, planned] as const];
    }),
  );
  return planReleaseWaves(repositories, published, runId, plans);
}

test('settles a dependency diamond before one consolidated consumer release', () => {
  const repositories = [
    repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.1', {
      ...emptyDependencies,
      dependencies: { '@ankhorage/left': '^1.0.0', '@ankhorage/right': '^1.0.0' },
    }),
    repository('ankhorage/right', '@ankhorage/right', '1.0.1', {
      ...emptyDependencies,
      dependencies: { '@ankhorage/base': '^1.0.0' },
    }),
    repository('ankhorage/base', '@ankhorage/base', '1.0.1'),
    repository('ankhorage/left', '@ankhorage/left', '1.0.1', {
      ...emptyDependencies,
      optionalDependencies: { '@ankhorage/base': '^1.0.0' },
    }),
  ];
  const published = repositories.map(({ packageName, packageVersion }) => ({
    name: packageName,
    version: packageVersion,
  }));

  const plan = fixturePlan(repositories, published, 'wave-1');

  expect(plan.blocked).toEqual([]);
  expect(plan.waves).toEqual([
    ['ankhorage/base'],
    ['ankhorage/left', 'ankhorage/right'],
    ['ankhorage/consumer'],
  ]);
  expect(plan.nodes.find((node) => node.repository === 'ankhorage/consumer')).toMatchObject({
    dependencies: ['ankhorage/left', 'ankhorage/right'],
  });
});

test('is deterministic across delayed and duplicate release input ordering', () => {
  const repositories = [
    repository('ankhorage/b', '@ankhorage/b', '1.0.0'),
    repository('ankhorage/a', '@ankhorage/a', '1.0.0'),
  ];
  const published = [
    { name: '@ankhorage/b', version: '1.0.0' },
    { name: '@ankhorage/a', version: '1.0.0' },
  ];

  expect(fixturePlan(repositories, published, 'wave').waves).toEqual([
    ['ankhorage/a', 'ankhorage/b'],
  ]);
  expect(fixturePlan([...repositories].reverse(), [...published].reverse(), 'wave').waves).toEqual([
    ['ankhorage/a', 'ankhorage/b'],
  ]);
});

test('reports runtime cycles without treating toolchain edges as release prerequisites', () => {
  const cycle = [
    repository('ankhorage/a', '@ankhorage/a', '1.0.0', {
      ...emptyDependencies,
      dependencies: { '@ankhorage/b': '^1.0.0' },
    }),
    repository('ankhorage/b', '@ankhorage/b', '1.0.0', {
      ...emptyDependencies,
      dependencies: { '@ankhorage/a': '^1.0.0' },
    }),
  ];
  expect(
    fixturePlan(
      cycle,
      cycle.map((item) => ({ name: item.packageName, version: '1.0.0' })),
      'cycle',
    ).blocked,
  ).toEqual(['release dependency cycle: ankhorage/a, ankhorage/b']);

  const upgrade = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    dependencies: { '@ankhorage/provider': '^25.0.0' },
    peerDependencies: { '@ankhorage/peer': '^24.1.2 || ^25.0.0' },
  });
  const provider = repository('ankhorage/provider', '@ankhorage/provider', '25.0.0');
  const plan = fixturePlan(
    [upgrade, provider],
    [
      { name: '@ankhorage/consumer', version: '1.0.0' },
      { name: '@ankhorage/provider', version: '26.0.0' },
    ],
    'upgrade',
  );
  expect(plan.blocked).toEqual([]);
  expect(plan.waves).toEqual([['ankhorage/provider'], ['ankhorage/consumer']]);
});

test('keeps private and non-publishable applications in coordinated verification waves', () => {
  const pending = {
    ...repository('ankhorage/pending', '@ankhorage/pending', '1.0.0'),
    bootstrapReady: false,
  };
  const privateRepository = {
    ...repository('ankhorage/private', '@ankhorage/private', '1.0.0'),
    private: true,
  };
  const nonPublishable = {
    ...repository('ankhorage/docs', '@ankhorage/docs', '1.0.0'),
    publishable: false,
  };
  const archived = { ...repository('ankhorage/old', '@ankhorage/old', '1.0.0'), archived: true };
  const excluded = {
    ...repository('ankhorage/exception', '@ankhorage/exception', '1.0.0'),
    excludedReason: 'security boundary',
  };
  const plan = fixturePlan(
    [pending, privateRepository, nonPublishable, archived, excluded],
    [],
    'inventory',
  );

  expect(plan.pendingBootstrap).toEqual(['ankhorage/pending']);
  expect(plan.blocked).toEqual([]);
  expect(plan.excluded).toEqual([
    'ankhorage/exception: excluded: security boundary',
    'ankhorage/old: archived',
  ]);
  expect(plan.nodes).toEqual([
    {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: undefined,
      packageName: '@ankhorage/docs',
      repository: 'ankhorage/docs',
      requiresNpmPublication: false,
    },
    {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: undefined,
      packageName: '@ankhorage/private',
      repository: 'ankhorage/private',
      requiresNpmPublication: false,
    },
  ]);
});

test('binds each direct selected Ankhorage dependency to its planned publication version', () => {
  const provider = repository('ankhorage/provider', '@ankhorage/provider', '1.0.0');
  const consumer = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    dependencies: { '@ankhorage/provider': '^1.0.0' },
  });

  const plan = fixturePlan(
    [consumer, provider],
    [
      { name: '@ankhorage/consumer', version: '1.0.0' },
      { name: '@ankhorage/provider', version: '1.0.0' },
    ],
    'exact-direct-inputs',
  );

  expect(plan.nodes.find((node) => node.repository === 'ankhorage/consumer')).toMatchObject({
    expectedDependencies: [{ packageName: '@ankhorage/provider', version: '1.0.1' }],
  });
});

test('includes direct development updates in evidence without creating release-order edges', () => {
  const provider = repository('ankhorage/provider', '@ankhorage/provider', '1.0.0');
  const consumer = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    devDependencies: { '@ankhorage/provider': '^1.0.0' },
  });

  const plan = fixturePlan(
    [consumer, provider],
    [
      { name: '@ankhorage/consumer', version: '1.0.0' },
      { name: '@ankhorage/provider', version: '1.0.0' },
    ],
    'development-evidence',
  );

  expect(plan.waves).toEqual([['ankhorage/consumer', 'ankhorage/provider']]);
  expect(plan.nodes.find((node) => node.repository === 'ankhorage/consumer')).toMatchObject({
    dependencies: [],
    expectedDependencies: [{ packageName: '@ankhorage/provider', version: '1.0.1' }],
  });
});

test('blocks a selected dependent when its selected provider is pending or absent', () => {
  const consumer = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    dependencies: { '@ankhorage/provider': '^1.0.0' },
  });
  const pending = {
    ...repository('ankhorage/provider', '@ankhorage/provider', '1.0.0'),
    bootstrapReady: false,
  };
  expect(
    fixturePlan(
      [consumer, pending],
      [{ name: '@ankhorage/consumer', version: '1.0.0' }],
      'blocked-provider',
    ).blocked,
  ).toEqual(['ankhorage/consumer: blocked provider @ankhorage/provider (pending-bootstrap)']);
  expect(
    fixturePlan([consumer], [{ name: '@ankhorage/consumer', version: '1.0.0' }], 'missing-provider')
      .blocked,
  ).toEqual(['ankhorage/consumer: unresolved external provider @ankhorage/provider']);
});

test('accepts a verified external provider without enrolling it for mutation', () => {
  const consumer = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    dependencies: { '@ankhorage/external': '^1.0.0' },
  });

  const plan = fixturePlan(
    [consumer],
    [
      { name: '@ankhorage/consumer', version: '1.0.0' },
      { name: '@ankhorage/external', version: '1.2.0' },
    ],
    'external-provider',
  );

  expect(plan.blocked).toEqual([]);
  expect(plan.waves).toEqual([['ankhorage/consumer']]);
});

test('requires a canonical Changesets release plan for every publishable node', () => {
  const publishable = {
    ...repository('ankhorage/package', '@ankhorage/package', '1.0.0'),
    plannedPublication: undefined,
  };
  const plan = fixturePlan(
    [publishable],
    [{ name: '@ankhorage/package', version: '1.0.0' }],
    'missing-publication-plan',
  );
  expect(plan.blocked).toEqual([
    'ankhorage/package: missing canonical Changesets publication plan',
  ]);
  expect(plan.nodes).toEqual([]);
});

test('rejects an arbitrary inventory version without a matching patch Changeset plan', () => {
  const publishable = {
    ...repository('ankhorage/package', '@ankhorage/package', '1.0.0'),
    plannedPublication: {
      packageName: '@ankhorage/other',
      releases: [{ packageName: '@ankhorage/other', type: 'patch' as const }],
      version: '9.9.9',
    },
  };
  expect(
    fixturePlan([publishable], [{ name: '@ankhorage/package', version: '1.0.0' }], 'bad-plan')
      .blocked,
  ).toEqual(['ankhorage/package: missing canonical Changesets publication plan']);
});

test('bounds concurrent work and makes terminal releases idempotent across recovery', () => {
  expect(partitionReleaseWave(['c', 'a', 'b'], 2)).toEqual([['a', 'b'], ['c']]);
  expect(() => partitionReleaseWave(['a'], 0)).toThrow('positive integer');
  const released = mergeReleaseWaveLedger(
    { nodes: {}, runId: 'resume' },
    'ankhorage/a',
    'released',
  );
  expect(mergeReleaseWaveLedger(released, 'ankhorage/a', 'ready')).toBe(released);
});
