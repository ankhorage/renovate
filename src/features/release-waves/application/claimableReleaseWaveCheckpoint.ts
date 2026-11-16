import { randomUUID } from 'node:crypto';

import type { ReleaseWaveCheckpoint } from '../ports/releaseWaveCheckpoint.js';
import type { ExecuteReleaseWavesInput } from './executeReleaseWavesAsync.js';
import { releaseWaveOperationId } from './validateReleaseWaveCheckpoint.js';

const leaseDurationMilliseconds = 5 * 60 * 1000;

/*** Construct a fresh owner lease while retaining the stable external operation identity. */
export function claimableReleaseWaveCheckpoint(
  input: ExecuteReleaseWavesInput,
  checkpoint: ReleaseWaveCheckpoint,
  repository: string,
  retainAwaitingReview: boolean,
): ReleaseWaveCheckpoint {
  return {
    ...checkpoint,
    failures: withoutKey(checkpoint.failures, repository),
    ledger: {
      ...checkpoint.ledger,
      nodes: {
        ...checkpoint.ledger.nodes,
        [repository]: retainAwaitingReview ? 'awaiting-review' : 'updating',
      },
      operations: {
        ...checkpoint.ledger.operations,
        [repository]: {
          fencingToken: claimGeneration(input.executorId),
          leaseExpiresAt: new Date(input.now().getTime() + leaseDurationMilliseconds).toISOString(),
          operationId: releaseWaveOperationId(input.plan.runId, repository),
          ownerId: input.executorId,
        },
      },
    },
  };
}

/*** Generate a fresh opaque fencing generation even when one executor reclaims within one clock tick. */
function claimGeneration(executorId: string): string {
  return executorId + ':' + randomUUID();
}

/*** Remove stale recovery detail once a new lease owns the operation. */
function withoutKey<T>(
  value: Readonly<Record<string, T>> | undefined,
  key: string,
): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([name]) => name !== key));
}
