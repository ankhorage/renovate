import type {
  ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointPort,
} from '../ports/releaseWaveCheckpoint.js';
import { ReleaseWaveCheckpointConflictError } from '../ports/releaseWaveCheckpoint.js';
import type {
  ReleaseWaveEventQueue,
  ReleaseWaveEventQueuePort,
} from '../ports/releaseWaveEventQueue.js';
import { ReleaseWaveEventQueueConflictError } from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';

/** Build deterministic coordinator inputs around a complete two-publisher cohort. */
export function coordinatorInput(
  queuePort: ReleaseWaveEventQueuePort,
  calls: string[],
  published = publications(),
) {
  return {
    checkpointPort: checkpointPort(),
    executionPort: executionPort(calls),
    executorId: 'test-executor',
    maximumCheckpointRetries: 3,
    maximumConcurrency: 1,
    maximumQueueRetries: 3,
    now: () => new Date('2026-11-16T00:00:00.000Z'),
    publishedPackages: [...publications(), { name: '@ankhorage/consumer', version: '1.1.0' }],
    queuePort,
    repositories: [repository('base'), repository('left'), consumerRepository()],
    settledPublications: published,
  };
}

/** Create one verified publisher event. */
export function event(name: string, version: string) {
  return {
    npmArtifactIntegrity: 'sha512-' + Buffer.from(name).toString('base64'),
    packageName: '@ankhorage/' + name,
    releaseId: name + '-' + version,
    releaseTag: 'v' + version,
    sourceRepository: 'ankhorage/' + name,
    version,
  };
}

/** Provide the complete planned publisher cohort. */
export function publications() {
  return ['base', 'left'].map((name) => ({ ...event(name, '1.1.0'), name: '@ankhorage/' + name }));
}

/** Create a planned publishable repository. */
export function repository(name: string) {
  const packageName = '@ankhorage/' + name;
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/' + name,
    packageName,
    packageVersion: '1.0.0',
    plannedPublication: {
      packageName,
      releases: [{ packageName, type: 'patch' as const }],
      version: '1.1.0',
    },
    private: false,
    publishable: true,
  };
}

/** Provide a revisioned in-memory durable queue. */
export function eventQueue(
  conflictingSaveAttempts: readonly number[] = [],
): ReleaseWaveEventQueuePort {
  let queue: ReleaseWaveEventQueue | undefined;
  let revision = 0;
  let saveAttempts = 0;
  return {
    loadReleaseWaveEventQueueAsync: () =>
      Promise.resolve(queue === undefined ? undefined : { queue, revision: String(revision) }),
    saveReleaseWaveEventQueueAsync: (next, expected) => {
      saveAttempts += 1;
      if (
        conflictingSaveAttempts.includes(saveAttempts) ||
        (queue !== undefined && expected !== String(revision))
      )
        throw new ReleaseWaveEventQueueConflictError();
      queue = next;
      revision += 1;
      return Promise.resolve({ queue: next, revision: String(revision) });
    },
  };
}

/** Create isolated checkpoint persistence. */
function checkpointPort(): ReleaseWaveCheckpointPort {
  let checkpoint: ReleaseWaveCheckpoint | undefined;
  let revision = 0;
  return {
    loadReleaseWaveCheckpointAsync: () =>
      Promise.resolve(
        checkpoint === undefined ? undefined : { checkpoint, revision: String(revision) },
      ),
    saveReleaseWaveCheckpointAsync: (_run, next, expected) => {
      if (checkpoint !== undefined && expected !== String(revision))
        throw new ReleaseWaveCheckpointConflictError('test');
      checkpoint = next;
      revision += 1;
      return Promise.resolve({ checkpoint: next, revision: String(revision) });
    },
  };
}

/** Record candidate creation and report complete downstream verification. */
function executionPort(calls: string[]): ReleaseWaveExecutionPort {
  const candidates = new Set<string>();
  return {
    reconcileReleaseWaveRepositoryAsync: ({ node }) =>
      Promise.resolve(candidates.has(node.repository) ? 'awaiting-review' : 'missing'),
    ensureReleaseWaveRepositoryAsync: ({ node }) => {
      candidates.add(node.repository);
      calls.push('ensure:' + node.repository);
      return Promise.resolve();
    },
    verifyReleaseWaveRepositoryAsync: () =>
      Promise.resolve({
        documentationGenerated: true,
        exactHeadCiPassed: true,
        lockfileUpdated: true,
        npmArtifactVerified: true,
        npmVersionVerified: true,
        releaseWorkflowPassed: true,
        requiredReviewsApproved: true,
      }),
  };
}

/** Link both publishers into the one downstream consumer. */
function consumerRepository() {
  return {
    ...repository('consumer'),
    dependencies: {
      dependencies: { '@ankhorage/base': '^1.0.0', '@ankhorage/left': '^1.0.0' },
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
  };
}
