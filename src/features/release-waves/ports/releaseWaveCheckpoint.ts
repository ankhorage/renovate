import type { ReleaseWaveLedger, ReleaseWavePlan } from '../../../types/releaseWave.js';

export interface ReleaseWaveCheckpoint {
  readonly ledger: ReleaseWaveLedger;
  readonly plan: ReleaseWavePlan;
}

export interface RevisionedReleaseWaveCheckpoint {
  readonly checkpoint: ReleaseWaveCheckpoint;
  readonly revision: string;
}

export interface ReleaseWaveCheckpointPort {
  loadReleaseWaveCheckpointAsync(
    runId: string,
  ): Promise<RevisionedReleaseWaveCheckpoint | undefined>;
  saveReleaseWaveCheckpointAsync(
    runId: string,
    checkpoint: ReleaseWaveCheckpoint,
    expectedRevision: string | undefined,
  ): Promise<RevisionedReleaseWaveCheckpoint>;
}

/*** Identify a concurrent persistent-state update that must be reloaded before retrying. */
export function isReleaseWaveCheckpointConflict(error: unknown): boolean {
  return error instanceof ReleaseWaveCheckpointConflictError;
}

/*** Report that a revisioned checkpoint compare-and-swap did not match current GitHub state. */
export class ReleaseWaveCheckpointConflictError extends Error {
  public constructor(runId: string) {
    super('Release-wave checkpoint revision conflict for ' + runId + '.');
    this.name = 'ReleaseWaveCheckpointConflictError';
  }
}
