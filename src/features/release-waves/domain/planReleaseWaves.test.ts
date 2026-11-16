import { expect, test } from 'bun:test';

import type { ReleaseWaveRepository } from '../../../types/releaseWave.js';
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
): ReleaseWaveRepository & { readonly packageName: string; readonly packageVersion: string } {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies,
    fullName,
    packageName,
    packageVersion: version,
    private: false,
    publishable: true,
  };
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

  const plan = planReleaseWaves(repositories, published, 'wave-1');

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

  expect(planReleaseWaves(repositories, published, 'wave').waves).toEqual([
    ['ankhorage/a', 'ankhorage/b'],
  ]);
  expect(
    planReleaseWaves([...repositories].reverse(), [...published].reverse(), 'wave').waves,
  ).toEqual([['ankhorage/a', 'ankhorage/b']]);
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
    planReleaseWaves(
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
  const plan = planReleaseWaves(
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
  const plan = planReleaseWaves(
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
      packageName: '@ankhorage/docs',
      repository: 'ankhorage/docs',
      requiresNpmPublication: false,
    },
    {
      dependencies: [],
      packageName: '@ankhorage/private',
      repository: 'ankhorage/private',
      requiresNpmPublication: false,
    },
  ]);
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
    planReleaseWaves(
      [consumer, pending],
      [{ name: '@ankhorage/consumer', version: '1.0.0' }],
      'blocked-provider',
    ).blocked,
  ).toEqual(['ankhorage/consumer: blocked provider @ankhorage/provider (pending-bootstrap)']);
  expect(
    planReleaseWaves(
      [consumer],
      [{ name: '@ankhorage/consumer', version: '1.0.0' }],
      'missing-provider',
    ).blocked,
  ).toEqual(['ankhorage/consumer: unresolved external provider @ankhorage/provider']);
});

test('accepts a verified external provider without enrolling it for mutation', () => {
  const consumer = repository('ankhorage/consumer', '@ankhorage/consumer', '1.0.0', {
    ...emptyDependencies,
    dependencies: { '@ankhorage/external': '^1.0.0' },
  });

  const plan = planReleaseWaves(
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
