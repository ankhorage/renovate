import { createHash } from 'node:crypto';

import type {
  PublishedPackage,
  ReleaseWavePlan,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';
import { planReleaseWaves } from '../domain/planReleaseWaves.js';
import type { ReleaseWaveCheckpointPort } from '../ports/releaseWaveCheckpoint.js';
import type {
  DurableReleaseWaveEvent,
  ReleaseWaveEventQueue,
  ReleaseWaveEventQueuePort,
} from '../ports/releaseWaveEventQueue.js';
import { isReleaseWaveEventQueueConflict } from '../ports/releaseWaveEventQueue.js';
import type { ReleaseWaveExecutionPort } from '../ports/releaseWaveExecution.js';
import { executeReleaseWavesAsync } from './executeReleaseWavesAsync.js';

/** Compose queue replay, actual-graph planning, durable checkpoints, and execution without provider imports. */
export async function runReleaseWaveCoordinatorAsync(input: {
  readonly checkpointPort: ReleaseWaveCheckpointPort;
  readonly executionPort: ReleaseWaveExecutionPort;
  readonly executorId: string;
  readonly maximumCheckpointRetries: number;
  readonly maximumConcurrency: number;
  readonly maximumQueueRetries: number;
  readonly now: () => Date;
  readonly publishedPackages: readonly PublishedPackage[];
  readonly queuePort: ReleaseWaveEventQueuePort;
  readonly repositories: readonly ReleaseWaveRepository[];
}): Promise<ReleaseWavePlan | undefined> {
  const current = await input.queuePort.loadReleaseWaveEventQueueAsync();
  const pending = (current?.queue.events ?? []).filter(
    (event) => event.acknowledgedRunId === undefined,
  );
  if (pending.length === 0) return undefined;
  const plan = planReleaseWaves(input.repositories, input.publishedPackages, runId(pending));
  if (plan.blocked.length > 0 || plan.waves.length === 0) return plan;
  const checkpoint = await executeReleaseWavesAsync({
    checkpointPort: input.checkpointPort,
    executionPort: input.executionPort,
    executorId: input.executorId,
    maximumCheckpointRetries: input.maximumCheckpointRetries,
    maximumConcurrency: input.maximumConcurrency,
    now: input.now,
    plan,
  });
  if (
    !plan.nodes.every((node) =>
      ['released', 'verified'].includes(checkpoint.ledger.nodes[node.repository] ?? ''),
    )
  )
    return plan;
  await acknowledgeEventsAsync(input.queuePort, pending, plan.runId, input.maximumQueueRetries);
  return plan;
}

/** Derive one deterministic run for all unacknowledged releases, never from dispatch arrival order. */
function runId(events: readonly DurableReleaseWaveEvent[]): string {
  return (
    'events-' +
    createHash('sha256')
      .update(
        events
          .map((event) => event.eventId)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 24)
  );
}

/** Acknowledge only a fully settled plan; CAS retries preserve events appended during execution. */
async function acknowledgeEventsAsync(
  queuePort: ReleaseWaveEventQueuePort,
  events: readonly DurableReleaseWaveEvent[],
  acknowledgedRunId: string,
  maximumRetries: number,
): Promise<void> {
  const ids = new Set(events.map((event) => event.eventId));
  for (let attempt = 0; attempt < maximumRetries; attempt += 1) {
    const current = await queuePort.loadReleaseWaveEventQueueAsync();
    if (current === undefined)
      throw new Error('Release-wave event queue disappeared during acknowledgement.');
    const queue: ReleaseWaveEventQueue = {
      events: current.queue.events.map((event) =>
        ids.has(event.eventId) && event.acknowledgedRunId === undefined
          ? { ...event, acknowledgedRunId }
          : event,
      ),
    };
    try {
      await queuePort.saveReleaseWaveEventQueueAsync(queue, current.revision);
      return;
    } catch (error) {
      if (!isReleaseWaveEventQueueConflict(error) || attempt + 1 === maximumRetries) throw error;
    }
  }
}
