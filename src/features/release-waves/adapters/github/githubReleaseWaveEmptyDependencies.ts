import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';

/*** Keep a visible non-package selected profile free of invented dependency declarations. */
export function githubReleaseWaveEmptyDependencies(): ReleaseWaveRepository['dependencies'] {
  return { dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {} };
}
