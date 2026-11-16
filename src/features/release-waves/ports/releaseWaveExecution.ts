import type { ReleaseWaveNode } from '../../../types/releaseWave.js';

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
  ensureReleaseWaveRepositoryAsync(input: {
    readonly node: ReleaseWaveNode;
    readonly runId: string;
  }): Promise<void>;
  verifyReleaseWaveRepositoryAsync(input: {
    readonly node: ReleaseWaveNode;
    readonly runId: string;
  }): Promise<ReleaseWaveVerification>;
}
