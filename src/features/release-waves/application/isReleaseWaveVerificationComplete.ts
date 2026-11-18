import type { ReleaseWaveVerification } from '../ports/releaseWaveExecution.js';

/*** Check the complete protected-release evidence set for publishable and nonpublishable profiles. */
export function isReleaseWaveVerificationComplete(
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
