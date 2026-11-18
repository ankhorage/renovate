import type { ReleaseWaveExecutionPort } from '../../ports/releaseWaveExecution.js';
import type { ReleaseWaveMutationFencePort } from '../../ports/releaseWaveMutationFence.js';

/** Guard every coordinator provider side effect with a fresh authoritative fence read. */
export function FencedReleaseWaveExecutionAdapter(input: {
  readonly executionPort: ReleaseWaveExecutionPort;
  readonly fencePort: ReleaseWaveMutationFencePort;
  readonly leaseId: string;
  readonly now: () => Date;
}): ReleaseWaveExecutionPort {
  return {
    collectReleaseWaveCandidatePublicationAsync: (value) =>
      input.executionPort.collectReleaseWaveCandidatePublicationAsync(value),
    ensureReleaseWaveRepositoryAsync: (value) =>
      executeCoordinatorMutationAsync(input, () =>
        input.executionPort.ensureReleaseWaveRepositoryAsync(value),
      ),
    reconcileReleaseWaveRepositoryAsync: (value) =>
      executeCoordinatorMutationAsync(input, () =>
        input.executionPort.reconcileReleaseWaveRepositoryAsync(value),
      ),
    verifyReleaseWaveRepositoryAsync: (value) =>
      input.executionPort.verifyReleaseWaveRepositoryAsync(value),
  };
}

/** Verify the current lease and durably prohibit rollback before invoking a coordinator mutator. */
async function executeCoordinatorMutationAsync<Value>(
  input: {
    readonly executionPort: ReleaseWaveExecutionPort;
    readonly fencePort: ReleaseWaveMutationFencePort;
    readonly leaseId: string;
    readonly now: () => Date;
  },
  mutationAsync: () => Promise<Value>,
): Promise<Value> {
  const now = input.now();
  await input.fencePort.assertReleaseWaveMutationLeaseAsync({
    leaseId: input.leaseId,
    mutator: 'coordinator',
    now,
  });
  await input.fencePort.recordReleaseWaveCoordinatorMutationAsync({ leaseId: input.leaseId, now });
  return mutationAsync();
}
