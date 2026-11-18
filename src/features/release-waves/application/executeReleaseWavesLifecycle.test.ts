import { expect, test } from 'bun:test';

import type { ReleaseWavePlan } from '../../../types/releaseWave.js';
import { planReleaseWaves } from '../domain/planReleaseWaves.js';
import {
  type ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointConflictError,
  type ReleaseWaveCheckpointPort,
} from '../ports/releaseWaveCheckpoint.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { executeReleaseWavesAsync } from './executeReleaseWavesAsync.js';

const candidateRevision = 'a'.repeat(40);
const candidatePublication = {
  packageName: '@ankhorage/consumer',
  releases: [{ packageName: '@ankhorage/consumer', type: 'patch' as const }],
  revision: candidateRevision,
  statusHash: 'b'.repeat(64),
  version: '1.0.1',
};
const completeVerification = {
  documentationGenerated: true,
  exactHeadCiPassed: true,
  lockfileUpdated: true,
  npmArtifactVerified: true,
  npmVersionVerified: true,
  releaseWorkflowPassed: true,
  requiredReviewsApproved: true,
};

test('plans before candidate Changesets, then binds one grouped candidate revision and patch decision', async () => {
  const plan = plannedConsumerWithoutChangeset();
  expect(plan.nodes).toMatchObject([
    { expectedPublication: undefined, repository: 'ankhorage/consumer' },
  ]);
  const calls: string[] = [];
  const executionPort: ReleaseWaveExecutionPort = {
    collectReleaseWaveCandidatePublicationAsync: () => {
      calls.push('changeset:' + candidateRevision);
      return Promise.resolve(candidatePublication);
    },
    ensureReleaseWaveRepositoryAsync: () => {
      calls.push('candidate');
      return Promise.resolve();
    },
    reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('missing'),
    verifyReleaseWaveRepositoryAsync: ({ node }) => {
      calls.push('verify:' + node.expectedPublication?.version);
      return Promise.resolve(completeVerification);
    },
  };
  const store = checkpointPort();
  const input = executionInput(plan, store, executionPort);

  const first = await executeReleaseWavesAsync(input);
  const replay = await executeReleaseWavesAsync(input);

  expect(calls).toEqual(['candidate', 'changeset:' + candidateRevision, 'verify:1.0.1']);
  expect(first.ledger.candidatePublications).toEqual({
    'ankhorage/consumer': candidatePublication,
  });
  expect(replay).toEqual(first);
});

test('keeps a merged candidate non-terminal until npm evidence completes', async () => {
  const plan = consumerPlan();
  const result = await executeReleaseWavesAsync(
    executionInput(plan, checkpointPort(), {
      collectReleaseWaveCandidatePublicationAsync: () => Promise.resolve(candidatePublication),
      ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
      reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('released'),
      verifyReleaseWaveRepositoryAsync: () =>
        Promise.resolve({
          ...completeVerification,
          npmArtifactVerified: false,
          npmVersionVerified: false,
        }),
    }),
  );
  expect(result.ledger.nodes['ankhorage/consumer']).toBe('awaiting-review');
});

test('replaces stale candidate Changesets evidence under its lease before delayed review can settle', async () => {
  const revisionA = 'a'.repeat(40);
  const revisionB = 'c'.repeat(40);
  const publications = [
    { ...candidatePublication, revision: revisionA },
    { ...candidatePublication, revision: revisionB, statusHash: 'd'.repeat(64), version: '1.0.2' },
  ];
  const calls: string[] = [];
  const executionPort: ReleaseWaveExecutionPort = {
    collectReleaseWaveCandidatePublicationAsync: () => {
      const publication = publications.shift();
      if (publication === undefined)
        throw new Error('candidate evidence was unexpectedly recollected');
      calls.push('collect:' + publication.revision);
      return Promise.resolve(publication);
    },
    ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
    reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('awaiting-review'),
    verifyReleaseWaveRepositoryAsync: ({ candidatePublication: publication }) => {
      calls.push('verify:' + publication.revision);
      return Promise.resolve(
        publication.revision === revisionB
          ? completeVerification
          : { ...completeVerification, exactHeadCiPassed: false },
      );
    },
  };
  const input = executionInput(consumerPlan(), checkpointPort(), executionPort);

  const delayed = await executeReleaseWavesAsync(input);
  const recovered = await executeReleaseWavesAsync({
    ...input,
    now: () => new Date('2026-11-18T01:00:00.000Z'),
  });

  expect(delayed.ledger.nodes['ankhorage/consumer']).toBe('awaiting-review');
  expect(recovered.ledger.nodes['ankhorage/consumer']).toBe('released');
  expect(recovered.ledger.candidatePublications?.['ankhorage/consumer']).toEqual({
    ...candidatePublication,
    revision: revisionB,
    statusHash: 'd'.repeat(64),
    version: '1.0.2',
  });
  expect(calls).toEqual([
    'collect:' + revisionA,
    'verify:' + revisionA,
    'collect:' + revisionB,
    'verify:' + revisionB,
  ]);
});

test('records candidate and candidate-Changeset failures without trusting a release', async () => {
  const plan = consumerPlan();
  for (const executionPort of [
    {
      collectReleaseWaveCandidatePublicationAsync: () => Promise.resolve(candidatePublication),
      ensureReleaseWaveRepositoryAsync: () => Promise.reject(new Error('candidate-create-failed')),
      reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('missing'),
      verifyReleaseWaveRepositoryAsync: () => Promise.resolve(completeVerification),
    },
    {
      collectReleaseWaveCandidatePublicationAsync: () =>
        Promise.reject(new Error('candidate-missing')),
      ensureReleaseWaveRepositoryAsync: () => Promise.resolve(),
      reconcileReleaseWaveRepositoryAsync: () => Promise.resolve('missing'),
      verifyReleaseWaveRepositoryAsync: () => Promise.resolve(completeVerification),
    },
  ] satisfies readonly ReleaseWaveExecutionPort[]) {
    const result = await executeReleaseWavesAsync(
      executionInput(plan, checkpointPort(), executionPort),
    );
    expect(result.ledger.nodes['ankhorage/consumer']).toBe('failed');
  }
});

/*** Model the pre-candidate planning boundary with no future Changeset required. */
function plannedConsumerWithoutChangeset(): ReleaseWavePlan {
  return planReleaseWaves(
    [
      {
        archived: false,
        bootstrapReady: true,
        dependencies: {
          dependencies: {},
          devDependencies: {},
          optionalDependencies: {},
          peerDependencies: {},
        },
        fullName: 'ankhorage/consumer',
        packageName: '@ankhorage/consumer',
        packageVersion: '1.0.0',
        private: false,
        publishable: true,
      },
    ],
    [{ name: '@ankhorage/consumer', version: '1.0.0' }],
    'candidate-lifecycle',
  );
}

/*** Reuse the pre-candidate plan as the candidate lifecycle's immutable run identity. */
function consumerPlan(): ReleaseWavePlan {
  return plannedConsumerWithoutChangeset();
}

/*** Execute fixture lifecycle work with fixed time and bounded retries. */
function executionInput(
  plan: ReleaseWavePlan,
  checkpointPort: ReleaseWaveCheckpointPort,
  executionPort: ReleaseWaveExecutionPort,
) {
  return {
    checkpointPort,
    executionPort,
    executorId: 'executor-1',
    maximumCheckpointRetries: 2,
    maximumConcurrency: 1,
    now: () => new Date('2026-11-18T00:00:00.000Z'),
    plan,
  };
}

/*** Persist fixtures with the same revisioned compare-and-swap contract as GitHub Contents. */
function checkpointPort(): ReleaseWaveCheckpointPort {
  let checkpoint: ReleaseWaveCheckpoint | undefined;
  let revision = 0;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: String(revision) },
      ),
    saveReleaseWaveCheckpointAsync: (_runId, next, expectedRevision) => {
      if (checkpoint !== undefined && expectedRevision !== String(revision))
        throw new ReleaseWaveCheckpointConflictError('candidate-lifecycle');
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint, revision: String(revision) });
    },
  };
}
