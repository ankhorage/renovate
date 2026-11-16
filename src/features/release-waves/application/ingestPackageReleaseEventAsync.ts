import type { ReleaseWaveEventQueuePort } from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWavePublicationEvidencePort } from '../ports/releaseWavePublicationEvidence.js';
import { ingestReleaseWaveEventAsync } from './ingestReleaseWaveEventAsync.js';

/*** Enrich the stable publisher dispatch contract before admitting a durable release-wave event. */
export async function ingestPackageReleaseEventAsync(input: {
  readonly maximumRetries: number;
  readonly publicationEvidencePort: ReleaseWavePublicationEvidencePort;
  readonly queuePort: ReleaseWaveEventQueuePort;
  readonly sourceRepository: string;
  readonly packageName: string;
  readonly version: string;
}) {
  const event = await input.publicationEvidencePort.enrichPackageReleaseAsync({
    package_name: input.packageName,
    source_repository: input.sourceRepository,
    version: input.version,
  });
  return ingestReleaseWaveEventAsync({
    event,
    maximumRetries: input.maximumRetries,
    queuePort: input.queuePort,
  });
}
