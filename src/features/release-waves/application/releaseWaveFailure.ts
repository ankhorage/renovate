import type { ReleaseWaveFailure, ReleaseWaveFailureCode } from '../../../types/releaseWave.js';
import { isReleaseWaveCheckpointConflict } from '../ports/releaseWaveCheckpoint.js';

/*** Classify unknown provider errors without retaining their potentially sensitive payload. */
export function releaseWaveFailure(error: unknown): ReleaseWaveFailure {
  const code: ReleaseWaveFailureCode = isReleaseWaveCheckpointConflict(error)
    ? 'checkpoint-conflict'
    : error instanceof Error && error.name === 'ReleaseWaveVerificationError'
      ? 'verification-failed'
      : 'execution-failed';
  return { code, diagnostic: 'Release-wave ' + code + '.', recoverable: true };
}
