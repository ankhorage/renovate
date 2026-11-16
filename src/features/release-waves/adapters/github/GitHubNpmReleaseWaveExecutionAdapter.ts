import type { ReleaseWaveExecutionPort } from '../../ports/releaseWaveExecution.js';
import { githubReleaseWaveCandidate } from './githubReleaseWaveCandidate.js';
import { githubReleaseWaveVerificationAsync } from './githubReleaseWaveVerification.js';

export interface GitHubNpmReleaseWaveExecutionAdapterInput {
  readonly apiBaseUrl: string;
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
    reconcileReleaseWaveRepositoryAsync: ({ node, operationId }) =>
      candidate.reconcileAsync(node, operationId),
    ensureReleaseWaveRepositoryAsync: ({ node, operationId }) =>
      candidate.ensureAsync(node, operationId),
    verifyReleaseWaveRepositoryAsync: ({ node, runId }) =>
      githubReleaseWaveVerificationAsync(input, node, runId),
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
