import type { ChangesetReleasePlan, ReleaseWaveNode } from '../../../types/releaseWave.js';

export interface ReleaseWaveVerification {
  readonly documentationGenerated: boolean;
  readonly exactHeadCiPassed: boolean;
  readonly lockfileUpdated: boolean;
  readonly npmArtifactVerified?: boolean;
  readonly npmVersionVerified?: boolean;
  readonly releaseWorkflowPassed: boolean;
  readonly requiredReviewsApproved: boolean;
}

export interface ReleaseWaveExecutionPort {
  /** Collect one clean immutable candidate Changesets decision after its grouped PR exists. */
  collectReleaseWaveCandidatePublicationAsync(input: {
    readonly node: ReleaseWaveNode;
    readonly operationId: string;
    readonly runId: string;
  }): Promise<ChangesetReleasePlan>;
  /** Reconcile the durable operation identity before a reclaimed lease may create a candidate. */
  reconcileReleaseWaveRepositoryAsync(input: {
    readonly node: ReleaseWaveNode;
    readonly operationId: string;
    readonly runId: string;
  }): Promise<'awaiting-review' | 'released' | 'missing'>;
  ensureReleaseWaveRepositoryAsync(input: {
    readonly node: ReleaseWaveNode;
    readonly operationId: string;
    readonly runId: string;
  }): Promise<void>;
  verifyReleaseWaveRepositoryAsync(input: {
    /** Immutable Changesets evidence whose candidate revision every review and CI record must match. */
    readonly candidatePublication: ChangesetReleasePlan;
    readonly node: ReleaseWaveNode;
    readonly runId: string;
  }): Promise<ReleaseWaveVerification>;
}
