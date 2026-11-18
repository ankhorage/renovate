import { expect, test } from 'bun:test';

import type { ChangesetReleasePlan, ReleaseWavePlan } from '../../../types/releaseWave.js';
import { validateReleaseWaveCheckpoint } from './validateReleaseWaveCheckpoint.js';

const plan: ReleaseWavePlan = {
  blocked: [],
  excluded: [],
  nodes: [
    {
      dependencies: [],
      expectedDependencies: [],
      expectedPublication: undefined,
      packageName: '@ankhorage/consumer',
      repository: 'ankhorage/consumer',
      requiresNpmPublication: true,
    },
  ],
  pendingBootstrap: [],
  runId: 'candidate-recovery',
  waves: [['ankhorage/consumer']],
};

/** Reject recovered evidence that cannot be the named node's exact candidate patch decision. */
test('rejects tampered candidate package, patch declaration, revision, status hash, and version', () => {
  for (const candidatePublication of [
    { ...publication, packageName: '@ankhorage/other' },
    { ...publication, releases: [] },
    { ...publication, revision: 'not-a-candidate-revision' },
    { ...publication, statusHash: 'not-a-status-hash' },
    { ...publication, version: 'not-a-release-version' },
  ])
    expect(() => validateReleaseWaveCheckpoint(plan, checkpoint(candidatePublication))).toThrow(
      'Persisted release-wave candidate publication is invalid.',
    );
});

const publication = {
  packageName: '@ankhorage/consumer',
  releases: [{ packageName: '@ankhorage/consumer', type: 'patch' as const }],
  revision: 'a'.repeat(40),
  statusHash: 'b'.repeat(64),
  version: '1.0.1',
};

/** Build one otherwise valid checkpoint with an intentionally adversarial durable evidence record. */
function checkpoint(candidatePublication: ChangesetReleasePlan) {
  return {
    ledger: {
      candidatePublications: { 'ankhorage/consumer': candidatePublication },
      nodes: { 'ankhorage/consumer': 'awaiting-review' as const },
      runId: plan.runId,
    },
    plan,
  };
}
