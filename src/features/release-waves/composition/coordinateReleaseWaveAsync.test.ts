import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

const source = readFileSync(
  new URL(
    '../../../../src/features/release-waves/composition/coordinateReleaseWaveAsync.ts',
    import.meta.url,
  ),
  'utf8',
);

test('uses the controlled Ankhorage-only non-automerge Renovate candidate policy', () => {
  expect(source).toContain('runReleaseWaveRenovateAsync(repository, input.configuration.token)');
});

test('limits registry evidence and candidate checkouts to eligible selected profiles', () => {
  expect(source).toContain('repository.archived ||');
  expect(source).toContain('Release-wave candidate is not eligible for checkout.');
  expect(source).toContain('repository.bootstrapReady');
  expect(source).toContain('repository.excludedReason !== undefined');
});

test('persists verified ingress before resolving only a previously frozen publisher epoch', () => {
  expect(source).not.toContain('prepareReleaseWavePublisherEpochAsync');
  expect(source).toContain('admitVerifiedPackageReleaseEventAsync({');
  expect(source.indexOf('admitVerifiedPackageReleaseEventAsync({')).toBeLessThan(
    source.indexOf('executeCoordinatorAsync({'),
  );
  expect(
    source.indexOf('const inventory = await collectGitHubReleaseWaveInventoryAsync('),
  ).toBeGreaterThan(source.indexOf('async function executeCoordinatorAsync'));
  expect(source).toContain('releaseWaveMutationFenceFromEnvironment(environment)');
  expect(source).toContain('FencedReleaseWaveExecutionAdapter({');
  expect(source).toContain('leaseId: input.configuration.mutationLeaseId');
  expect(source).toContain('executionPort: GitHubNpmReleaseWaveExecutionAdapter({');
});
