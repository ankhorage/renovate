import { createHash } from 'node:crypto';

import { gt, valid } from 'semver';

import type {
  ChangesetReleaseDecision,
  ReleaseWaveRepository,
} from '../../../../types/releaseWave.js';
import type { ReleaseWavePublisherEpoch } from '../../ports/releaseWavePublicationCohort.js';
import type {
  ReleaseWavePublisherEpochPort,
  ReleaseWavePublisherEpochWriterPort,
} from '../../ports/releaseWavePublisherEpoch.js';
import { assertCompleteReleaseWavePublisherDecisions } from './githubReleaseWavePublisherDecisions.js';

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
): ReleaseWavePublisherEpochPort & ReleaseWavePublisherEpochWriterPort {
  return {
    adoptReleaseWavePublisherEpochAsync: (request) =>
      adoptReleaseWavePublisherEpochAsync(input, request),
    loadReleaseWavePublisherEpochsAsync: ({ inventoryId, repositories }) =>
      loadReleaseWavePublisherEpochsAsync(input, inventoryId, repositories),
  };
}

/** Create or adopt one CAS-fenced epoch from selected-App revisions and verified Changesets intent. */
async function adoptReleaseWavePublisherEpochAsync(
  input: GitHubReleaseWavePublisherEpochAdapterInput,
  request: Parameters<
    ReleaseWavePublisherEpochWriterPort['adoptReleaseWavePublisherEpochAsync']
  >[0],
): Promise<ReleaseWavePublisherEpoch> {
  const epoch = plannedEpoch(
    request.inventoryId,
    request.repositories,
    request.publicationDecisions,
  );
  const current = await readReleasePlanAsync(input, true);
  const existing = adoptedEpoch(current, epoch);
  if (existing !== undefined) return existing;
  const scheduledPackages = new Set(epoch.publishers.map((publisher) => publisher.packageName));
  if (
    current.plan.epochs.some((candidate) =>
      candidate.publishers.some((publisher) => scheduledPackages.has(publisher.packageName)),
    )
  )
    throw new Error('Release-wave publisher epoch overlaps an unacknowledged immutable epoch.');
  const plan = { epochs: [...current.plan.epochs, epoch] };
  const response = await input.requestAsync(
    input.apiBaseUrl + '/repos/' + input.repository + '/contents/' + epochPath(),
    {
      body: JSON.stringify({
        branch: input.branch,
        content: Buffer.from(JSON.stringify(plan) + '\n').toString('base64'),
        message: 'chore(release-wave): adopt publisher epoch',
        sha: current.revision,
      }),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + input.token,
        'content-type': 'application/json',
      },
      method: 'PUT',
    },
  );
  if (!response.ok) {
    if ([409, 422].includes(response.status))
      throw new Error('Release-wave publisher epoch CAS conflict.');
    throw new Error('Release-wave publisher epoch could not be persisted.');
  }
  const saved: unknown = await response.json();
  const revision = contentRevision(saved);
  return { ...epoch, sourceRevision: revision };
}

/*** Reuse only an exactly matching persisted epoch with its immutable write revision. */
function adoptedEpoch(
  current: {
    readonly plan: {
      readonly epochs: readonly Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>[];
    };
    readonly revision: string | undefined;
  },
  epoch: Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>,
): ReleaseWavePublisherEpoch | undefined {
  const existing = current.plan.epochs.find((candidate) => candidate.id === epoch.id);
  if (existing === undefined) return undefined;
  if (!sameEpoch(existing, epoch))
    throw new Error('Release-wave epoch identity has conflicting content.');
  if (current.revision === undefined)
    throw new Error('Release-wave publisher epoch adoption lost its immutable revision.');
  return { ...existing, sourceRevision: current.revision };
}

/*** Load a revisioned release plan and refuse schedules not bound to the selected inventory. */
async function loadReleaseWavePublisherEpochsAsync(
  input: GitHubReleaseWavePublisherEpochAdapterInput,
  inventoryId: string,
  repositories: readonly ReleaseWaveRepository[],
): Promise<readonly ReleaseWavePublisherEpoch[]> {
  if (repositories.length === 0)
    throw new Error('Release-wave selected installation inventory is empty.');
  const { plan, revision } = await readReleasePlanAsync(input, false);
  if (revision === undefined)
    throw new Error('Release-wave publisher epoch plan has no immutable revision.');
  const epochs = plan.epochs.filter((epoch) => epoch.inventoryId === inventoryId);
  if (epochs.length === 0)
    throw new Error('Release-wave publisher epoch plan does not cover the selected installation.');
  return epochs.map((epoch) => ({ ...epoch, sourceRevision: revision }));
}

/** Load an existing immutable document; first creation is allowed only by the authoritative producer. */
async function readReleasePlanAsync(
  input: GitHubReleaseWavePublisherEpochAdapterInput,
  allowAbsent: boolean,
): Promise<{
  readonly plan: { readonly epochs: readonly Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>[] };
  readonly revision: string | undefined;
}> {
  const response = await input.requestAsync(
    input.apiBaseUrl +
      '/repos/' +
      input.repository +
      '/contents/' +
      epochPath() +
      '?ref=' +
      encodeURIComponent(input.branch),
    { headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + input.token } },
  );
  if (response.status === 404 && allowAbsent) return { plan: { epochs: [] }, revision: undefined };
  if (!response.ok)
    throw new Error('Release-wave publisher epoch plan could not be authenticated.');
  const parsed = parseReleasePlan(await response.json());
  return { plan: { epochs: parsed.epochs }, revision: parsed.revision };
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
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.id) ||
    typeof value.inventoryId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.inventoryId) ||
    !Array.isArray(value.publishers) ||
    value.publishers.length === 0 ||
    !value.publishers.every(isScheduledPublisher)
  )
    return false;
  return value.id === epochIdentity(value.inventoryId, canonicalPublishers(value.publishers));
}

/*** Narrow a provider schedule before its immutable identity is recomputed. */
function isScheduledPublisher(
  value: unknown,
): value is ReleaseWavePublisherEpoch['publishers'][number] {
  return (
    isRecord(value) &&
    typeof value.packageName === 'string' &&
    /^@ankhorage\/[a-z0-9][a-z0-9-]*$/.test(value.packageName) &&
    typeof value.planRevision === 'string' &&
    /^[a-f0-9]{40}$/.test(value.planRevision) &&
    typeof value.planStatusHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.planStatusHash) &&
    typeof value.sourceRepository === 'string' &&
    /^ankhorage\/[a-z0-9][a-z0-9-]*$/.test(value.sourceRepository) &&
    typeof value.version === 'string' &&
    valid(value.version) === value.version
  );
}

/** Derive the only admissible schedule from exact selected source revisions and patch Changesets intent. */
function plannedEpoch(
  inventoryId: string,
  repositories: readonly ReleaseWaveRepository[],
  publicationDecisions: ReadonlyMap<string, ChangesetReleaseDecision>,
): Omit<ReleaseWavePublisherEpoch, 'sourceRevision'> {
  if (!/^[a-f0-9]{64}$/.test(inventoryId))
    throw new Error('Release-wave publisher epoch inventory identity is invalid.');
  const selected = new Map(repositories.map((repository) => [repository.fullName, repository]));
  if (selected.size !== repositories.length)
    throw new Error('Selected installation has duplicate repositories.');
  assertCompleteReleaseWavePublisherDecisions(selected, publicationDecisions);
  const publishers = [...publicationDecisions.entries()].flatMap(([repositoryName, decision]) =>
    decision.releasePlan === undefined
      ? []
      : [publisherFromPlan(selected.get(repositoryName), decision)],
  );
  if (publishers.length === 0)
    throw new Error('Release-wave publisher epoch has no trusted release intent.');
  if (new Set(publishers.map((publisher) => publisher.packageName)).size !== publishers.length)
    throw new Error('Release-wave publisher epoch has duplicate package identities.');
  const canonical = canonicalPublishers(publishers);
  return {
    id: epochIdentity(inventoryId, canonical),
    inventoryId,
    publishers: canonical,
  };
}

/** Translate only an exact selected Changesets decision into a future publisher identity. */
function publisherFromPlan(
  repository: ReleaseWaveRepository | undefined,
  decision: ChangesetReleaseDecision,
): ReleaseWavePublisherEpoch['publishers'][number] {
  const plan = decision.releasePlan;
  if (plan === undefined) throw new Error('Release-wave publisher plan is missing.');
  const [release] = plan.releases;
  if (
    repository?.publishable !== true ||
    repository.packageName !== plan.packageName ||
    repository.packageVersion === undefined ||
    repository.sourceRevision !== plan.revision ||
    plan.statusHash !== decision.statusHash ||
    valid(plan.version) !== plan.version ||
    !gt(plan.version, repository.packageVersion) ||
    release === undefined ||
    plan.releases.length !== 1 ||
    release.packageName !== plan.packageName ||
    release.type !== 'patch'
  )
    throw new Error(
      'Release-wave publisher intent is not bound to a selected immutable Changesets source.',
    );
  return {
    packageName: plan.packageName,
    planRevision: plan.revision,
    planStatusHash: plan.statusHash,
    sourceRepository: repository.fullName,
    version: plan.version,
  };
}

/** Compare every immutable scheduling field before treating a previously written epoch as an adoption. */
function sameEpoch(
  left: Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>,
  right: Omit<ReleaseWavePublisherEpoch, 'sourceRevision'>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/*** Recompute the canonical epoch digest before immutable provider state can govern a release. */
function epochIdentity(
  inventoryId: string,
  publishers: readonly ReleaseWavePublisherEpoch['publishers'][number][],
): string {
  return createHash('sha256')
    .update(
      inventoryId +
        '\n' +
        publishers
          .map((publisher) =>
            [
              publisher.packageName,
              publisher.planRevision,
              publisher.planStatusHash,
              publisher.sourceRepository,
              publisher.version,
            ].join('\n'),
          )
          .join('\n\n'),
    )
    .digest('hex');
}

/*** Sort every persisted identity field before hashing or serializing an epoch. */
function canonicalPublishers(
  publishers: readonly ReleaseWavePublisherEpoch['publishers'][number][],
): readonly ReleaseWavePublisherEpoch['publishers'][number][] {
  return [...publishers].sort((left, right) => left.packageName.localeCompare(right.packageName));
}

/** Extract the exact new Git blob revision returned by the Contents CAS write. */
function contentRevision(value: unknown): string {
  if (
    !isRecord(value) ||
    !isRecord(value.content) ||
    typeof value.content.sha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.content.sha)
  )
    throw new Error(
      'Release-wave publisher epoch write did not return an immutable content revision.',
    );
  return value.content.sha;
}

/** Keep one provider-controlled path for both immutable reads and CAS writes. */
function epochPath(): string {
  return '.github/release-wave-publisher-epochs.json';
}

/*** Narrow external JSON without leaking provider types into the release-wave port. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
