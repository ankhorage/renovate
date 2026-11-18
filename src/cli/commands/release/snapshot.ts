import { acknowledgeReleaseWavePublisherSnapshotFromEnvironmentAsync } from '../../../features/release-waves/composition/acknowledgeReleaseWavePublisherSnapshotAsync.js';
import type { ReleaseWavePublisherSnapshotRequest } from '../../../features/release-waves/ports/releaseWavePublisherSnapshot.js';

/*** Deliver the authenticated repository-dispatch request through the thin CLI boundary. */
await acknowledgeReleaseWavePublisherSnapshotFromEnvironmentAsync({
  environment: process.env,
  request: snapshotRequestFromEnvironment(process.env),
});

/*** Decode the one canonical publisher-to-Renovate wire contract before any stateful composition. */
function snapshotRequestFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ReleaseWavePublisherSnapshotRequest {
  const source = environment.RELEASE_WAVE_PUBLISHER_SNAPSHOT_REQUEST;
  if (source === undefined) throw new Error('Release-wave publisher snapshot request is missing.');
  const value: unknown = JSON.parse(source);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Release-wave publisher snapshot request is malformed.');
  return value as ReleaseWavePublisherSnapshotRequest;
}
