/** A mutation family which must never run beside the other family. */
export type ReleaseWaveMutator = 'coordinator' | 'legacy';

/** A durable, time-bounded claim to perform one release-wave mutation. */
export interface ReleaseWaveMutationLease {
  readonly expiresAt: string;
  readonly leaseId: string;
  readonly mutator: ReleaseWaveMutator;
}

/** The result of closing legacy admission and draining already admitted work. */
export interface ReleaseWaveCutoverState {
  readonly activeLeases: readonly ReleaseWaveMutationLease[];
  readonly mode: ReleaseWaveMutator;
}

/** Persist and verify the exclusive mutator admission boundary. */
export interface ReleaseWaveMutationFencePort {
  acquireReleaseWaveMutationLeaseAsync(input: {
    readonly leaseId: string;
    readonly mutator: ReleaseWaveMutator;
    readonly now: Date;
    readonly ttlMilliseconds: number;
  }): Promise<ReleaseWaveMutationLease>;
  assertReleaseWaveMutationLeaseAsync(input: {
    readonly leaseId: string;
    readonly mutator: ReleaseWaveMutator;
    readonly now: Date;
  }): Promise<void>;
  beginReleaseWaveCoordinatorCutoverAsync(input: {
    readonly now: Date;
  }): Promise<ReleaseWaveCutoverState>;
  recordReleaseWaveCoordinatorMutationAsync(input: {
    readonly leaseId: string;
    readonly now: Date;
  }): Promise<void>;
  releaseReleaseWaveMutationLeaseAsync(input: {
    readonly leaseId: string;
    readonly now: Date;
  }): Promise<void>;
  rollbackReleaseWaveCoordinatorCutoverAsync(input: { readonly now: Date }): Promise<void>;
}
