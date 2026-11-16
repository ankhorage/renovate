import type { ReleaseWaveLedger, ReleaseWavePlan } from '../../../types/releaseWave.js';
import { partitionReleaseWave } from '../domain/planReleaseWaves.js';
import type {
  ReleaseWaveCheckpoint,
  ReleaseWaveCheckpointPort,
  RevisionedReleaseWaveCheckpoint,
} from '../ports/releaseWaveCheckpoint.js';
import { isReleaseWaveCheckpointConflict } from '../ports/releaseWaveCheckpoint.js';
import type {
  ReleaseWaveExecutionPort,
  ReleaseWaveVerification,
} from '../ports/releaseWaveExecution.js';

export interface ExecuteReleaseWavesInput {
  readonly checkpointPort: ReleaseWaveCheckpointPort;
  readonly executionPort: ReleaseWaveExecutionPort;
  readonly maximumConcurrency: number;
  readonly maximumCheckpointRetries: number;
  readonly plan: ReleaseWavePlan;
}

/*** Resume a release plan with checkpoint-before-side-effect and wave-order preservation. */
export async function executeReleaseWavesAsync(
  input: ExecuteReleaseWavesInput,
): Promise<ReleaseWaveCheckpoint> {
  const checkpoint = await loadOrCreateReleaseWaveCheckpointAsync(input);
  for (const [waveIndex, wave] of checkpoint.plan.waves.entries()) {
    const prerequisites = checkpoint.plan.waves.slice(0, waveIndex).flat();
    const current = await requireReleaseWaveCheckpointAsync(input);
    if (!isReleaseWaveComplete(current.checkpoint, prerequisites)) return current.checkpoint;
    for (const batch of partitionReleaseWave(wave, input.maximumConcurrency)) {
      await Promise.all(
        batch.map((repository) => executeReleaseWaveRepositoryAsync(input, repository)),
      );
    }
    const settled = await requireReleaseWaveCheckpointAsync(input);
    if (!isReleaseWaveComplete(settled.checkpoint, wave)) return settled.checkpoint;
  }
  return (await requireReleaseWaveCheckpointAsync(input)).checkpoint;
}

/*** Load existing durable state or atomically establish the initial plan ledger. */
async function loadOrCreateReleaseWaveCheckpointAsync(
  input: ExecuteReleaseWavesInput,
): Promise<ReleaseWaveCheckpoint> {
  const existing = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
  if (existing !== undefined) return existing.checkpoint;
  const checkpoint: ReleaseWaveCheckpoint = {
    ledger: {
      nodes: Object.fromEntries([
        ...input.plan.nodes.map((node) => [node.repository, 'ready'] as const),
        ...input.plan.pendingBootstrap.map(
          (repository) => [repository, 'pending-bootstrap'] as const,
        ),
        ...input.plan.blocked.map((entry) => [readRepository(entry), 'blocked'] as const),
      ]),
      runId: input.plan.runId,
    },
    plan: input.plan,
  };
  return saveWithRetryAsync(input, checkpoint, undefined).then((result) => result.checkpoint);
}

/*** Execute one repository only after durable state records that its operation is resumable. */
async function executeReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
): Promise<void> {
  const node = input.plan.nodes.find((candidate) => candidate.repository === repository);
  if (node === undefined)
    throw new Error('Release-wave plan is missing repository ' + repository + '.');
  const claimed = await transitionReleaseWaveRepositoryAsync(input, repository, 'updating');
  if (!claimed) return;
  await input.executionPort.ensureReleaseWaveRepositoryAsync({ node, runId: input.plan.runId });
  await transitionReleaseWaveRepositoryAsync(input, repository, 'awaiting-review');
  const verification = await input.executionPort.verifyReleaseWaveRepositoryAsync({
    node,
    runId: input.plan.runId,
  });
  if (isReleaseWaveVerificationComplete(node.requiresNpmPublication, verification)) {
    await transitionReleaseWaveRepositoryAsync(
      input,
      repository,
      node.requiresNpmPublication ? 'released' : 'verified',
    );
  }
}

/*** Save a node transition with revisioned retries so concurrent workers cannot overwrite progress. */
async function transitionReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  status: ReleaseWaveLedger['nodes'][string],
): Promise<boolean> {
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    const current = await requireReleaseWaveCheckpointAsync(input);
    const nodes = new Map(Object.entries(current.checkpoint.ledger.nodes));
    const currentStatus = nodes.get(repository);
    if (
      currentStatus === 'released' ||
      currentStatus === 'verified' ||
      currentStatus === 'blocked'
    ) {
      return false;
    }
    nodes.set(repository, status);
    const checkpoint: ReleaseWaveCheckpoint = {
      ...current.checkpoint,
      ledger: { ...current.checkpoint.ledger, nodes: Object.fromEntries(nodes) },
    };
    try {
      await input.checkpointPort.saveReleaseWaveCheckpointAsync(
        input.plan.runId,
        checkpoint,
        current.revision,
      );
      return true;
    } catch (error) {
      if (
        !isReleaseWaveCheckpointConflict(error) ||
        attempt + 1 === input.maximumCheckpointRetries
      ) {
        throw error;
      }
    }
  }
  throw new Error('Release-wave checkpoint retry budget is invalid.');
}

/*** Retry a durable compare-and-swap only for explicitly detected concurrent writers. */
async function saveWithRetryAsync(
  input: ExecuteReleaseWavesInput,
  checkpoint: ReleaseWaveCheckpoint,
  initialRevision: string | undefined,
): Promise<RevisionedReleaseWaveCheckpoint> {
  let revision = initialRevision;
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    try {
      return await input.checkpointPort.saveReleaseWaveCheckpointAsync(
        input.plan.runId,
        checkpoint,
        revision,
      );
    } catch (error) {
      if (
        !isReleaseWaveCheckpointConflict(error) ||
        attempt + 1 === input.maximumCheckpointRetries
      ) {
        throw error;
      }
      const latest = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
      revision = latest?.revision;
    }
  }
  throw new Error('Release-wave checkpoint retry budget is invalid.');
}

/*** Require checkpoint presence after initialization so recovery cannot silently lose state. */
async function requireReleaseWaveCheckpointAsync(
  input: ExecuteReleaseWavesInput,
): Promise<RevisionedReleaseWaveCheckpoint> {
  const checkpoint = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
  if (checkpoint === undefined)
    throw new Error('Release-wave checkpoint disappeared during execution.');
  return checkpoint;
}

/*** Prevent a downstream wave from starting until every prerequisite has passed all release gates. */
function isReleaseWaveComplete(
  checkpoint: ReleaseWaveCheckpoint,
  repositories: readonly string[],
): boolean {
  return repositories.every((repository) => {
    const status = new Map(Object.entries(checkpoint.ledger.nodes)).get(repository);
    return status === 'released' || status === 'verified';
  });
}

/*** Check every required release proof before allowing the next dependency wave to progress. */
function isReleaseWaveVerificationComplete(
  requiresNpmPublication: boolean,
  verification: ReleaseWaveVerification,
): boolean {
  return (
    verification.documentationGenerated &&
    verification.exactHeadCiPassed &&
    verification.lockfileUpdated &&
    verification.releaseWorkflowPassed &&
    verification.requiredReviewsApproved &&
    (!requiresNpmPublication ||
      (verification.npmArtifactVerified === true && verification.npmVersionVerified === true))
  );
}

/*** Extract a repository identity from the planner's deterministic diagnostic format. */
function readRepository(entry: string): string {
  const [repository] = entry.split(':', 1);
  if (repository === undefined)
    throw new Error('Release-wave diagnostic is missing its repository.');
  return repository;
}
