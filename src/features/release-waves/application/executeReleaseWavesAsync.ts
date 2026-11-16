import type {
  ReleaseWaveLedger,
  ReleaseWaveOperation,
  ReleaseWavePlan,
} from '../../../types/releaseWave.js';
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
import { claimableReleaseWaveCheckpoint } from './claimableReleaseWaveCheckpoint.js';
import {
  releaseWaveNodeStatus,
  releaseWaveOperation,
  releaseWaveOperationId,
  validateReleaseWaveCheckpoint,
} from './validateReleaseWaveCheckpoint.js';

export interface ExecuteReleaseWavesInput {
  readonly checkpointPort: ReleaseWaveCheckpointPort;
  readonly executionPort: ReleaseWaveExecutionPort;
  readonly executorId: string;
  readonly maximumCheckpointRetries: number;
  readonly maximumConcurrency: number;
  readonly now: () => Date;
  readonly plan: ReleaseWavePlan;
}

/*** Resume a validated release plan with durable claims before each external side effect. */
export async function executeReleaseWavesAsync(
  input: ExecuteReleaseWavesInput,
): Promise<ReleaseWaveCheckpoint> {
  validateExecutionInput(input);
  const checkpoint = await loadOrCreateReleaseWaveCheckpointAsync(input);
  for (const [waveIndex, wave] of checkpoint.plan.waves.entries()) {
    const prerequisites = checkpoint.plan.waves.slice(0, waveIndex).flat();
    if (
      !isReleaseWaveComplete(
        (await requireReleaseWaveCheckpointAsync(input)).checkpoint,
        prerequisites,
      )
    )
      return (await requireReleaseWaveCheckpointAsync(input)).checkpoint;
    for (const batch of partitionReleaseWave(wave, input.maximumConcurrency))
      await Promise.all(
        batch.map((repository) => executeReleaseWaveRepositoryAsync(input, repository)),
      );
    if (!isReleaseWaveComplete((await requireReleaseWaveCheckpointAsync(input)).checkpoint, wave))
      return (await requireReleaseWaveCheckpointAsync(input)).checkpoint;
  }
  return (await requireReleaseWaveCheckpointAsync(input)).checkpoint;
}

/*** Load durable state or atomically create it, adopting—not overwriting—a competing initializer. */
async function loadOrCreateReleaseWaveCheckpointAsync(
  input: ExecuteReleaseWavesInput,
): Promise<ReleaseWaveCheckpoint> {
  const existing = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
  if (existing !== undefined) return validateReleaseWaveCheckpoint(input.plan, existing.checkpoint);
  const checkpoint: ReleaseWaveCheckpoint = {
    ledger: {
      nodes: Object.fromEntries(
        input.plan.nodes.map((node) => [node.repository, 'ready'] as const),
      ),
      runId: input.plan.runId,
    },
    plan: input.plan,
  };
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    try {
      return (
        await input.checkpointPort.saveReleaseWaveCheckpointAsync(
          input.plan.runId,
          checkpoint,
          undefined,
        )
      ).checkpoint;
    } catch (error) {
      if (!isReleaseWaveCheckpointConflict(error)) throw error;
      const winner = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
      if (winner !== undefined) return validateReleaseWaveCheckpoint(input.plan, winner.checkpoint);
      if (attempt + 1 === input.maximumCheckpointRetries) throw error;
    }
  }
  throw new Error('Release-wave checkpoint retry budget is invalid.');
}

/*** Execute an exclusively claimed operation, reconciling a reclaimed operation before mutation. */
async function executeReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
): Promise<void> {
  const node = input.plan.nodes.find((candidate) => candidate.repository === repository);
  if (node === undefined)
    throw new Error('Release-wave plan is missing repository ' + repository + '.');
  if ((await claimReleaseWaveRepositoryAsync(input, repository)) === 'none') return;
  const operationId = releaseWaveOperationId(input.plan.runId, repository);
  try {
    const reconciliation = await input.executionPort.reconcileReleaseWaveRepositoryAsync({
      node,
      operationId,
      runId: input.plan.runId,
    });
    if (reconciliation === 'released') {
      await transitionReleaseWaveRepositoryAsync(input, repository, 'released');
      return;
    }
    if (reconciliation === 'missing')
      await input.executionPort.ensureReleaseWaveRepositoryAsync({
        node,
        operationId,
        runId: input.plan.runId,
      });
    await transitionReleaseWaveRepositoryAsync(input, repository, 'awaiting-review');
    const verification = await input.executionPort.verifyReleaseWaveRepositoryAsync({
      node,
      runId: input.plan.runId,
    });
    if (isReleaseWaveVerificationComplete(node.requiresNpmPublication, verification))
      await transitionReleaseWaveRepositoryAsync(
        input,
        repository,
        node.requiresNpmPublication ? 'released' : 'verified',
      );
  } catch (error) {
    await failReleaseWaveRepositoryAsync(input, repository, error);
  }
}

/*** Claim ready, failed, or expired work with CAS; active and review states cannot be stolen. */
async function claimReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
): Promise<'claimed' | 'none'> {
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    const current = await requireReleaseWaveCheckpointAsync(input);
    const status = releaseWaveNodeStatus(current.checkpoint.ledger, repository);
    const operation = releaseWaveOperation(current.checkpoint.ledger, repository);
    if (!isClaimableReleaseWaveOperation(status, operation, input.now())) return 'none';
    const checkpoint = claimableReleaseWaveCheckpoint(input, current.checkpoint, repository);
    try {
      await input.checkpointPort.saveReleaseWaveCheckpointAsync(
        input.plan.runId,
        checkpoint,
        current.revision,
      );
      return 'claimed';
    } catch (error) {
      if (!isReleaseWaveCheckpointConflict(error) || attempt + 1 === input.maximumCheckpointRetries)
        throw error;
    }
  }
  throw new Error('Release-wave checkpoint retry budget is invalid.');
}

/*** Persist a state transition only when it is valid for the authoritative checkpoint. */
async function transitionReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  status: ReleaseWaveLedger['nodes'][string],
): Promise<void> {
  await updateCheckpointAsync(input, repository, (checkpoint, current) => {
    if (current === status || current === 'released' || current === 'verified') return checkpoint;
    if (!isAllowedTransition(current, status))
      throw new Error('Release-wave transition is invalid: ' + current + ' to ' + status + '.');
    return {
      ...checkpoint,
      ledger: { ...checkpoint.ledger, nodes: { ...checkpoint.ledger.nodes, [repository]: status } },
    };
  });
}

/*** Record an actionable, recoverable failure while retaining the deterministic operation identity. */
async function failReleaseWaveRepositoryAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  error: unknown,
): Promise<void> {
  await updateCheckpointAsync(input, repository, (checkpoint, current) => ({
    ...checkpoint,
    failures: {
      ...checkpoint.failures,
      [repository]: { message: errorMessage(error), recoverable: true },
    },
    ledger: {
      ...checkpoint.ledger,
      nodes: {
        ...checkpoint.ledger.nodes,
        [repository]: current === 'released' ? current : 'failed',
      },
    },
  }));
}

/*** Apply a validated checkpoint update with bounded GitHub Contents compare-and-swap retries. */
async function updateCheckpointAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  update: (
    checkpoint: ReleaseWaveCheckpoint,
    current: ReleaseWaveLedger['nodes'][string],
  ) => ReleaseWaveCheckpoint,
): Promise<void> {
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    const current = await requireReleaseWaveCheckpointAsync(input);
    const status = releaseWaveNodeStatus(current.checkpoint.ledger, repository);
    if (status === undefined)
      throw new Error('Release-wave checkpoint is missing repository ' + repository + '.');
    const next = update(current.checkpoint, status);
    if (next === current.checkpoint) return;
    try {
      await input.checkpointPort.saveReleaseWaveCheckpointAsync(
        input.plan.runId,
        next,
        current.revision,
      );
      return;
    } catch (error) {
      if (!isReleaseWaveCheckpointConflict(error) || attempt + 1 === input.maximumCheckpointRetries)
        throw error;
    }
  }
  throw new Error('Release-wave checkpoint retry budget is invalid.');
}

/*** Require and validate durable state before every side effect. */
async function requireReleaseWaveCheckpointAsync(
  input: ExecuteReleaseWavesInput,
): Promise<RevisionedReleaseWaveCheckpoint> {
  const checkpoint = await input.checkpointPort.loadReleaseWaveCheckpointAsync(input.plan.runId);
  if (checkpoint === undefined)
    throw new Error('Release-wave checkpoint disappeared during execution.');
  return {
    ...checkpoint,
    checkpoint: validateReleaseWaveCheckpoint(input.plan, checkpoint.checkpoint),
  };
}

/*** Check complete wave settlement before any dependent observes an intermediate upstream result. */
function isReleaseWaveComplete(
  checkpoint: ReleaseWaveCheckpoint,
  repositories: readonly string[],
): boolean {
  return repositories.every((repository) => {
    const status = releaseWaveNodeStatus(checkpoint.ledger, repository);
    return status === 'released' || status === 'verified';
  });
}

/*** Check the complete protected-release evidence set for publishable and nonpublishable profiles. */
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

/*** Keep status movement monotonic except an explicit recoverable failure retry. */
function isAllowedTransition(
  current: ReleaseWaveLedger['nodes'][string],
  next: ReleaseWaveLedger['nodes'][string],
): boolean {
  return (
    (current === 'updating' && (next === 'awaiting-review' || next === 'released')) ||
    (current === 'awaiting-review' && (next === 'verified' || next === 'released')) ||
    (current === 'verified' && next === 'released') ||
    (current === 'failed' && next === 'updating')
  );
}

/*** Reject settled, review-owned, and currently leased work before an executor attempts a claim. */
function isClaimableReleaseWaveOperation(
  status: ReleaseWaveLedger['nodes'][string] | undefined,
  operation: ReleaseWaveOperation | undefined,
  now: Date,
): boolean {
  return (
    status !== undefined &&
    status !== 'released' &&
    status !== 'verified' &&
    status !== 'awaiting-review' &&
    status !== 'blocked' &&
    !(
      status === 'updating' &&
      operation !== undefined &&
      operation.leaseExpiresAt > now.toISOString()
    )
  );
}

/*** Render unknown infrastructure failures without losing their recovery value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*** Reject invalid execution configuration before state or provider access. */
function validateExecutionInput(input: ExecuteReleaseWavesInput): void {
  if (!Number.isInteger(input.maximumCheckpointRetries) || input.maximumCheckpointRetries < 1)
    throw new Error('Release-wave checkpoint retry budget must be a positive integer.');
  if (!Number.isInteger(input.maximumConcurrency) || input.maximumConcurrency < 1)
    throw new Error('Release-wave concurrency must be a positive integer.');
  if (input.executorId.length === 0) throw new Error('Release-wave executor identity is required.');
}
