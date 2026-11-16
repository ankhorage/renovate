import { createHash } from 'node:crypto';

import type { ReleaseWaveEvent } from '../ports/releaseWaveEventQueue.js';

/*** Validate and identify one immutable publication event before it enters durable coordination. */
export function releaseWaveEventIdentity(event: ReleaseWaveEvent): string {
  validateReleaseWaveEvent(event);
  return createHash('sha256')
    .update(
      [
        event.sourceRepository,
        event.packageName,
        event.version,
        event.npmArtifactIntegrity,
        event.releaseId,
        event.releaseTag,
      ].join('\n'),
    )
    .digest('hex');
}

/*** Reject publication identities that cannot be independently verified and replayed. */
export function validateReleaseWaveEvent(event: ReleaseWaveEvent): void {
  if (!/^@ankhorage\/[a-z0-9][a-z0-9-]*$/.test(event.packageName))
    throw new Error('Release-wave event package name is invalid.');
  if (!/^ankhorage\/[a-z0-9-]+$/.test(event.sourceRepository))
    throw new Error('Release-wave event source repository is invalid.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(event.version))
    throw new Error('Release-wave event version is invalid.');
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(event.npmArtifactIntegrity))
    throw new Error('Release-wave event npm artifact integrity is invalid.');
  if (event.releaseId.length === 0 || event.releaseTag.length === 0)
    throw new Error('Release-wave event release evidence is invalid.');
}
