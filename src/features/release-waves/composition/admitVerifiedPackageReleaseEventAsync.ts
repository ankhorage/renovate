import { ingestPackageReleaseEventAsync } from '../application/ingestPackageReleaseEventAsync.js';
import type {
  DurableReleaseWaveEvent,
  ReleaseWaveEventQueuePort,
} from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWavePublicationEvidencePort } from '../ports/releaseWavePublicationEvidence.js';

/*** Persist one verified post-publish dispatch without coupling ingress admission to epoch recovery. */
export async function admitVerifiedPackageReleaseEventAsync(input: {
  readonly maximumRetries: number;
  readonly packageName: string;
  readonly publicationEvidencePort: ReleaseWavePublicationEvidencePort;
  readonly queuePort: ReleaseWaveEventQueuePort;
  readonly sourceRepository: string;
  readonly version: string;
}): Promise<DurableReleaseWaveEvent> {
  return ingestPackageReleaseEventAsync(input);
}
