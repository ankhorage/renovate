import type { ReleaseWaveLedger, ReleaseWaveOperation } from '../../../types/releaseWave.js';
import type {
  ReleaseWaveCheckpoint,
  RevisionedReleaseWaveCheckpoint,
} from '../ports/releaseWaveCheckpoint.js';
import { isReleaseWaveCheckpointConflict } from '../ports/releaseWaveCheckpoint.js';
import type { ExecuteReleaseWavesInput } from './executeReleaseWavesAsync.js';
import {
  releaseWaveNodeStatus,
  releaseWaveOperation,
  validateReleaseWaveCheckpoint,
} from './validateReleaseWaveCheckpoint.js';

/*** Apply a fenced validated checkpoint update with bounded compare-and-swap retries. */
export async function updateReleaseWaveCheckpointAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  update: (
    checkpoint: ReleaseWaveCheckpoint,
    current: ReleaseWaveLedger['nodes'][string],
  ) => ReleaseWaveCheckpoint,
  claim: ReleaseWaveOperation,
): Promise<void> {
  for (let attempt = 0; attempt < input.maximumCheckpointRetries; attempt += 1) {
    const current = await requireReleaseWaveCheckpointAsync(input);
    const status = releaseWaveNodeStatus(current.checkpoint.ledger, repository);
    if (status === undefined)
      throw new Error('Release-wave checkpoint is missing repository ' + repository + '.');
    if (!isCurrentClaim(releaseWaveOperation(current.checkpoint.ledger, repository), claim)) return;
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

/*** Require and validate durable state before every external side effect. */
export async function requireReleaseWaveCheckpointAsync(
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

/*** Require exact owner and fencing identity before a writer may make progress. */
function isCurrentClaim(
  current: ReleaseWaveOperation | undefined,
  claim: ReleaseWaveOperation,
): boolean {
  return (
    current?.fencingToken === claim.fencingToken &&
    current.ownerId === claim.ownerId &&
    current.operationId === claim.operationId
  );
}
