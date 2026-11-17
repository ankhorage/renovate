import { createHash } from 'node:crypto';

import type {
  ChangesetReleasePlan,
  PublishedPackage,
  ReleaseWavePlan,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';
import { planReleaseWaves } from '../domain/planReleaseWaves.js';
import { releaseWaveEventIdentity } from '../domain/releaseWaveEventIdentity.js';
import type { ReleaseWaveCheckpointPort } from '../ports/releaseWaveCheckpoint.js';
import type {
  DurableReleaseWaveEvent,
  ReleaseWaveEventQueue,
  ReleaseWaveEventQueuePort,
} from '../ports/releaseWaveEventQueue.js';
import { isReleaseWaveEventQueueConflict } from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { executeReleaseWavesAsync } from './executeReleaseWavesAsync.js';

type SettledPublication = PublishedPackage & {
  readonly npmArtifactIntegrity: string;
  readonly releaseId: string;
  readonly releaseTag: string;
  readonly sourceRepository: string;
};

/*** Compose an explicitly settled publication cohort into one replay-safe consumer release wave. */
export async function runReleaseWaveCoordinatorAsync(input: {
  readonly checkpointPort: ReleaseWaveCheckpointPort;
  readonly executionPort: ReleaseWaveExecutionPort;
  readonly executorId: string;
  readonly maximumCheckpointRetries: number;
  readonly maximumConcurrency: number;
  readonly maximumQueueRetries: number;
  readonly now: () => Date;
  readonly publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>;
  /** Current verified inventory used only to validate consumer candidates, never to acknowledge an event. */
  readonly publishedPackages: readonly PublishedPackage[];
  readonly queuePort: ReleaseWaveEventQueuePort;
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly settledPublications: readonly SettledPublication[];
}): Promise<ReleaseWavePlan | undefined> {
  const publications = validateSettledPublications(input.settledPublications);
  const events = completeCohortEvents(
    (await input.queuePort.loadReleaseWaveEventQueueAsync())?.queue,
    publications,
  );
  if (events === undefined) return undefined;
  const runId = logicalWaveId(publications);
  const { closurePlan, plan } = plansForCohort(
    input.repositories,
    publications,
    input.publishedPackages,
    input.publicationPlans,
    runId,
  );
  if (closurePlan.waves.length > 0)
    await executeReleaseWavesAsync({
      checkpointPort: input.checkpointPort,
      executionPort: input.executionPort,
      executorId: input.executorId,
      maximumCheckpointRetries: input.maximumCheckpointRetries,
      maximumConcurrency: input.maximumConcurrency,
      now: input.now,
      plan,
    });
  if (closurePlan.blocked.length > 0) return plan;
  if (!(await allPlanNodesSettledAsync(input.checkpointPort, plan))) return plan;
  await acknowledgeEventsAsync(input.queuePort, events, plan.runId, input.maximumQueueRetries);
  return plan;
}

/*** Prevent queue acknowledgement until every planned consumer reached a durable terminal state. */
async function allPlanNodesSettledAsync(
  checkpointPort: ReleaseWaveCheckpointPort,
  plan: ReleaseWavePlan,
): Promise<boolean> {
  const checkpoint =
    plan.nodes.length === 0
      ? undefined
      : await checkpointPort.loadReleaseWaveCheckpointAsync(plan.runId);
  return (
    checkpoint === undefined ||
    plan.nodes.every((node) =>
      ['released', 'verified'].includes(checkpoint.checkpoint.ledger.nodes[node.repository] ?? ''),
    )
  );
}

/*** Retain full selected-inventory audit while confining candidate mutations to the affected closure. */
function plansForCohort(
  repositories: readonly ReleaseWaveRepository[],
  publications: readonly SettledPublication[],
  publishedPackages: readonly PublishedPackage[],
  publicationPlans: ReadonlyMap<string, ChangesetReleasePlan>,
  runId: string,
): { readonly closurePlan: ReleaseWavePlan; readonly plan: ReleaseWavePlan } {
  const closurePlan = planReleaseWaves(
    affectedConsumers(repositories, publications),
    publishedPackages,
    runId,
    publicationPlans,
  );
  const inventoryPlan = planReleaseWaves(repositories, publishedPackages, runId, publicationPlans);
  return {
    closurePlan,
    plan: {
      ...closurePlan,
      blocked: inventoryPlan.blocked,
      excluded: inventoryPlan.excluded,
      pendingBootstrap: inventoryPlan.pendingBootstrap,
    },
  };
}

/*** Require a complete exact cohort before any consumer can observe a partial update. */
function completeCohortEvents(
  queue: ReleaseWaveEventQueue | undefined,
  publications: readonly SettledPublication[],
): readonly DurableReleaseWaveEvent[] | undefined {
  const expected = new Map(
    publications.map((publication) => [
      releaseWaveEventIdentity(publicationEvent(publication)),
      publication,
    ]),
  );
  const matching = (queue?.events ?? []).filter((event) => expected.has(event.eventId));
  if (
    matching.length === 0 &&
    publications.every(
      (publication) =>
        queue?.acknowledgedEvents?.[releaseWaveEventIdentity(publicationEvent(publication))] !==
        undefined,
    )
  )
    return undefined;
  if (matching.length !== expected.size) return undefined;
  for (const event of matching) {
    const publication = expected.get(event.eventId);
    if (publication === undefined || !samePublication(event, publication))
      throw new Error('Release-wave queue event does not match its verified publication evidence.');
    if (event.acknowledgedRunId !== undefined)
      throw new Error('Release-wave cohort mixes acknowledged and pending events.');
  }
  return matching;
}

/*** Use the immutable complete cohort, rather than a transient queue snapshot, as checkpoint identity. */
function logicalWaveId(publications: readonly SettledPublication[]): string {
  return (
    'wave-' +
    createHash('sha256')
      .update(
        publications
          .map((publication) => releaseWaveEventIdentity(publicationEvent(publication)))
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 24)
  );
}

/*** Restrict mutation to consumers reachable from settled upstream packages in the selected inventory. */
function affectedConsumers(
  repositories: readonly ReleaseWaveRepository[],
  publications: readonly SettledPublication[],
): readonly ReleaseWaveRepository[] {
  const affectedPackages = new Set(publications.map((publication) => publication.name));
  const selected: ReleaseWaveRepository[] = [];
  for (;;) {
    const next = repositories.filter(
      (repository) =>
        !selected.includes(repository) &&
        updateDependencies(repository).some((dependency) => affectedPackages.has(dependency)),
    );
    if (next.length === 0) return selected;
    selected.push(...next);
    for (const repository of next)
      if (repository.packageName !== undefined) affectedPackages.add(repository.packageName);
  }
}

/*** Follow every dependency declaration for update closure while preserving runtime-only wave edges. */
function updateDependencies(repository: ReleaseWaveRepository): readonly string[] {
  return [
    ...Object.keys(repository.dependencies.dependencies),
    ...Object.keys(repository.dependencies.devDependencies),
    ...Object.keys(repository.dependencies.optionalDependencies),
  ];
}

/*** Reject ambiguous, malformed, or duplicate publication evidence before it can name a wave. */
function validateSettledPublications(
  publications: readonly SettledPublication[],
): readonly SettledPublication[] {
  if (publications.length === 0) throw new Error('Release-wave settlement evidence is empty.');
  const ids = publications.map((publication) =>
    releaseWaveEventIdentity(publicationEvent(publication)),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error('Release-wave settlement evidence contains duplicate publication identities.');
  return [...publications].sort((left, right) =>
    releaseWaveEventIdentity(publicationEvent(left)).localeCompare(
      releaseWaveEventIdentity(publicationEvent(right)),
    ),
  );
}

/*** Compare every release and npm proof field; a package name alone is never acknowledgement evidence. */
function samePublication(event: DurableReleaseWaveEvent, publication: SettledPublication): boolean {
  return (
    event.packageName === publication.name &&
    event.version === publication.version &&
    event.sourceRepository === publication.sourceRepository &&
    event.npmArtifactIntegrity === publication.npmArtifactIntegrity &&
    event.releaseId === publication.releaseId &&
    event.releaseTag === publication.releaseTag
  );
}

/*** Present verified package evidence in the event identity shape without inventing a second hash contract. */
function publicationEvent(publication: SettledPublication): DurableReleaseWaveEvent {
  return {
    eventId: '',
    npmArtifactIntegrity: publication.npmArtifactIntegrity,
    packageName: publication.name,
    releaseId: publication.releaseId,
    releaseTag: publication.releaseTag,
    sourceRepository: publication.sourceRepository,
    version: publication.version,
  };
}

/*** Acknowledge a fully settled cohort and compact bodies while retaining replay-safe audit identities. */
async function acknowledgeEventsAsync(
  queuePort: ReleaseWaveEventQueuePort,
  events: readonly DurableReleaseWaveEvent[],
  acknowledgedRunId: string,
  maximumRetries: number,
): Promise<void> {
  if (events.length === 0) return;
  const ids = new Set(events.map((event) => event.eventId));
  for (let attempt = 0; attempt < maximumRetries; attempt += 1) {
    const current = await queuePort.loadReleaseWaveEventQueueAsync();
    if (current === undefined)
      throw new Error('Release-wave event queue disappeared during acknowledgement.');
    const queue: ReleaseWaveEventQueue = {
      acknowledgedEvents: {
        ...current.queue.acknowledgedEvents,
        ...Object.fromEntries([...ids].map((eventId) => [eventId, acknowledgedRunId])),
      },
      events: current.queue.events.filter((event) => !ids.has(event.eventId)),
    };
    try {
      await queuePort.saveReleaseWaveEventQueueAsync(queue, current.revision);
      return;
    } catch (error) {
      if (!isReleaseWaveEventQueueConflict(error) || attempt + 1 === maximumRetries) throw error;
    }
  }
}
