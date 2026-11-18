import type { ReleaseWaveCheckout } from '../../../../types/releaseWave.js';
import type { ReleaseWaveExecutionPort } from '../../ports/releaseWaveExecution.js';
import { changesetReleasePlansAsync } from '../changesets/changesetReleasePlansAsync.js';
import { githubReleaseWaveCandidate } from './githubReleaseWaveCandidate.js';
import { githubReleaseWaveVerificationAsync } from './githubReleaseWaveVerification.js';

export interface GitHubNpmReleaseWaveExecutionAdapterInput {
  readonly apiBaseUrl: string;
  readonly candidateCheckoutAsync?: (input: {
    readonly repository: string;
    readonly revision: string;
  }) => Promise<ReleaseWaveCheckout & { readonly cleanupAsync?: () => Promise<void> }>;
  readonly npmRegistryUrl: string;
  readonly owner: string;
  readonly releaseWorkflowFile: string;
  readonly renovateAsync: (repository: string) => Promise<void>;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly token: string;
}

/*** Adapt authenticated GitHub and npm evidence to the durable release-wave port. */
export function GitHubNpmReleaseWaveExecutionAdapter(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
): ReleaseWaveExecutionPort {
  validateAdapterInput(input);
  const candidate = githubReleaseWaveCandidate(input);
  return {
    collectReleaseWaveCandidatePublicationAsync: async ({ node, operationId }) => {
      const revision = await candidate.headRevisionAsync(node, operationId);
      if (input.candidateCheckoutAsync === undefined)
        throw new Error('candidate-checkout-unavailable');
      const checkout = await input.candidateCheckoutAsync({
        repository: node.repository,
        revision,
      });
      try {
        if (checkout.revision !== revision) throw new Error('candidate-checkout-revision-mismatch');
        const plan = (await changesetReleasePlansAsync({ [node.repository]: checkout })).get(
          node.repository,
        );
        if (plan === undefined) throw new Error('candidate-changeset-plan-missing');
        if ((await candidate.headRevisionAsync(node, operationId)) !== revision)
          throw new Error('candidate-head-changed-during-changeset-collection');
        return plan;
      } finally {
        await checkout.cleanupAsync?.();
      }
    },
    reconcileReleaseWaveRepositoryAsync: ({ node, operationId }) =>
      candidate.reconcileAsync(node, operationId),
    ensureReleaseWaveRepositoryAsync: ({ node, operationId }) =>
      candidate.ensureAsync(node, operationId),
    verifyReleaseWaveRepositoryAsync: ({ candidatePublication, node, runId }) =>
      githubReleaseWaveVerificationAsync(input, node, runId, candidatePublication.revision),
  };
}

/*** Validate immutable adapter configuration before provider access. */
function validateAdapterInput(input: GitHubNpmReleaseWaveExecutionAdapterInput): void {
  if (
    !input.apiBaseUrl ||
    !input.npmRegistryUrl ||
    !input.owner ||
    !input.releaseWorkflowFile ||
    !input.token
  )
    throw new Error('Release-wave GitHub/npm adapter configuration is incomplete.');
}
