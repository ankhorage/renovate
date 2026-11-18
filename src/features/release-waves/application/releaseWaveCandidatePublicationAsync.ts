import type {
  ChangesetReleasePlan,
  ReleaseWaveOperation,
  ReleaseWavePlan,
} from '../../../types/releaseWave.js';
import type { ExecuteReleaseWavesInput } from './executeReleaseWavesAsync.js';
import {
  requireReleaseWaveCheckpointAsync,
  updateReleaseWaveCheckpointAsync,
} from './updateReleaseWaveCheckpointAsync.js';

/*** Bind exactly one candidate Changesets plan before any CI, review, or release evidence is trusted. */
export async function collectReleaseWaveCandidatePublicationAsync(
  input: ExecuteReleaseWavesInput,
  node: ReleaseWavePlan['nodes'][number],
  operationId: string,
  claim: ReleaseWaveOperation,
): Promise<void> {
  const publication = await input.executionPort.collectReleaseWaveCandidatePublicationAsync({
    node,
    operationId,
    runId: input.plan.runId,
  });
  if (!isCandidatePublication(node, publication))
    throw new Error('Release-wave candidate Changesets publication is invalid.');
  const existing = await candidatePublicationAsync(input, node.repository, false);
  if (sameCandidatePublication(existing, publication)) return;
  await updateReleaseWaveCheckpointAsync(
    input,
    node.repository,
    (checkpoint, status) =>
      status === 'verified' || status === 'released'
        ? checkpoint
        : {
            ...checkpoint,
            ledger: {
              ...checkpoint.ledger,
              candidatePublications: {
                ...checkpoint.ledger.candidatePublications,
                [node.repository]: publication,
              },
            },
          },
    claim,
  );
}

/** Compare all immutable evidence fields before deciding a CAS replacement is necessary. */
function sameCandidatePublication(
  existing: ChangesetReleasePlan | undefined,
  next: ChangesetReleasePlan,
): boolean {
  const [existingRelease] = existing?.releases ?? [];
  const [nextRelease] = next.releases;
  return (
    existingRelease !== undefined &&
    nextRelease !== undefined &&
    existing?.packageName === next.packageName &&
    existing.revision === next.revision &&
    existing.statusHash === next.statusHash &&
    existing.version === next.version &&
    existingRelease.packageName === nextRelease.packageName &&
    existingRelease.type === nextRelease.type
  );
}

/*** Read only exact package-level candidate publication evidence already bound to this durable run. */
export async function candidatePublicationAsync(
  input: ExecuteReleaseWavesInput,
  repository: string,
  required = true,
): Promise<ChangesetReleasePlan | undefined> {
  const { checkpoint } = await requireReleaseWaveCheckpointAsync(input);
  const publication = Object.entries(checkpoint.ledger.candidatePublications ?? {}).find(
    ([name]) => name === repository,
  )?.[1];
  if (publication === undefined && required)
    throw new Error('Release-wave candidate Changesets publication is missing.');
  return publication;
}

/*** Require the sole immutable patch decision for the package represented by this candidate. */
function isCandidatePublication(
  node: ReleaseWavePlan['nodes'][number],
  publication: ChangesetReleasePlan,
): boolean {
  const release = publication.releases.at(0);
  return (
    publication.packageName === node.packageName &&
    /^[0-9a-f]{40}$/u.test(publication.revision) &&
    /^[a-f0-9]{64}$/u.test(publication.statusHash ?? '') &&
    publication.releases.length === 1 &&
    release?.packageName === node.packageName &&
    release.type === 'patch'
  );
}
