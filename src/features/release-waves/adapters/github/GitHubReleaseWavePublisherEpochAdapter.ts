import type { ReleaseWaveRepository } from '../../../../types/releaseWave.js';
import type { ReleaseWavePublisherEpoch } from '../../ports/releaseWavePublicationCohort.js';
import type { ReleaseWavePublisherEpochPort } from '../../ports/releaseWavePublisherEpoch.js';

interface GitHubReleaseWavePublisherEpochAdapterInput {
  readonly apiBaseUrl: string;
  readonly branch: string;
  readonly requestAsync: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly repository: string;
  readonly token: string;
}

/*** Read the signed-in Renovate App's immutable release-plan schedule from its control repository. */
export function GitHubReleaseWavePublisherEpochAdapter(
  input: GitHubReleaseWavePublisherEpochAdapterInput,
): ReleaseWavePublisherEpochPort {
  return {
    loadReleaseWavePublisherEpochsAsync: ({ inventoryId, repositories }) =>
      loadReleaseWavePublisherEpochsAsync(input, inventoryId, repositories),
  };
}

/*** Load a revisioned release plan and refuse schedules not bound to the selected inventory. */
async function loadReleaseWavePublisherEpochsAsync(
  input: GitHubReleaseWavePublisherEpochAdapterInput,
  inventoryId: string,
  repositories: readonly ReleaseWaveRepository[],
): Promise<readonly ReleaseWavePublisherEpoch[]> {
  if (repositories.length === 0)
    throw new Error('Release-wave selected installation inventory is empty.');
  const response = await input.requestAsync(
    input.apiBaseUrl +
      '/repos/' +
      input.repository +
      '/contents/.github/release-wave-publisher-epochs.json?ref=' +
      encodeURIComponent(input.branch),
    { headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + input.token } },
  );
  if (!response.ok)
    throw new Error('Release-wave publisher epoch plan could not be authenticated.');
  const content: unknown = await response.json();
  const plan = parseReleasePlan(content);
  const epochs = plan.epochs.filter((epoch) => epoch.inventoryId === inventoryId);
  if (epochs.length === 0)
    throw new Error('Release-wave publisher epoch plan does not cover the selected installation.');
  return epochs.map((epoch) => ({ ...epoch, sourceRevision: plan.revision }));
}

/*** Decode only a complete, immutable plan document; malformed provider state is never treated as empty. */
function parseReleasePlan(value: unknown): {
  readonly epochs: readonly Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>[];
  readonly revision: string;
} {
  if (
    !isRecord(value) ||
    value.encoding !== 'base64' ||
    typeof value.content !== 'string' ||
    typeof value.sha !== 'string'
  )
    throw new Error('Release-wave publisher epoch plan is not a readable immutable GitHub file.');
  const source = Buffer.from(value.content, 'base64').toString('utf8');
  const document = JSON.parse(source) as unknown;
  if (
    !isRecord(document) ||
    !Array.isArray(document.epochs) ||
    document.epochs.some((epoch) => !isEpoch(epoch))
  )
    throw new Error('Release-wave publisher epoch plan is malformed.');
  return { epochs: document.epochs, revision: value.sha };
}

/*** Validate every schedule field before it can fence a durable consumer release. */
function isEpoch(value: unknown): value is Omit<ReleaseWavePublisherEpoch, 'sourceRevision'> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.inventoryId === 'string' &&
    value.inventoryId.length > 0 &&
    Array.isArray(value.publishers) &&
    value.publishers.length > 0 &&
    value.publishers.every(
      (publisher) =>
        isRecord(publisher) &&
        typeof publisher.packageName === 'string' &&
        typeof publisher.sourceRepository === 'string' &&
        typeof publisher.version === 'string',
    )
  );
}

/*** Narrow external JSON without leaking provider types into the release-wave port. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
