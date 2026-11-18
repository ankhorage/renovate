import { createHash } from 'node:crypto';

import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';

/*** Bind selected identities and immutable source revisions to one deterministic cohort snapshot. */
export function githubReleaseWaveSnapshotId(
  repositories: readonly ReleaseWaveRepository[],
): string {
  return createHash('sha256')
    .update(
      repositories
        .map((repository) =>
          [
            repository.fullName,
            repository.archived ? 'archived' : 'active',
            repository.bootstrapReady ? 'bootstrap-ready' : 'pending-bootstrap',
            repository.excludedReason ?? '',
            repository.packageName ?? '',
            repository.packageVersion ?? '',
            repository.private ? 'private' : 'public',
            repository.publishable ? 'publishable' : 'not-publishable',
            repository.sourceRevision ?? '',
            JSON.stringify(repository.dependencies),
          ].join('\\n'),
        )
        .sort()
        .join('\\n\\n'),
    )
    .digest('hex');
}
