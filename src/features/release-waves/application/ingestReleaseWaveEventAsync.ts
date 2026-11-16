import { createHash } from 'node:crypto';

import type {
  DurableReleaseWaveEvent,
  ReleaseWaveEvent,
  ReleaseWaveEventQueue,
  ReleaseWaveEventQueuePort,
} from '../ports/releaseWaveEventQueue.js';
import { isReleaseWaveEventQueueConflict } from '../ports/releaseWaveEventQueue.js';

/** Persist one normalized release event idempotently, retrying only compare-and-swap contention. */
export async function ingestReleaseWaveEventAsync(input: {
  readonly event: ReleaseWaveEvent;
  readonly maximumRetries: number;
  readonly queuePort: ReleaseWaveEventQueuePort;
}): Promise<DurableReleaseWaveEvent> {
  validateInput(input);
  const event = { ...input.event, eventId: releaseWaveEventId(input.event) };
  for (let attempt = 0; attempt < input.maximumRetries; attempt += 1) {
    const current = await input.queuePort.loadReleaseWaveEventQueueAsync();
    const existing = current?.queue.events.find((candidate) => candidate.eventId === event.eventId);
    if (existing !== undefined) return existing;
    const queue: ReleaseWaveEventQueue = {
      events: [...(current?.queue.events ?? []), event].sort(compareEvents),
    };
    try {
      await input.queuePort.saveReleaseWaveEventQueueAsync(queue, current?.revision);
      return event;
    } catch (error) {
      if (!isReleaseWaveEventQueueConflict(error) || attempt + 1 === input.maximumRetries)
        throw error;
    }
  }
  throw new Error('Release-wave event queue retry budget is invalid.');
}

/** Derive a stable opaque identity from the immutable published package identity. */
function releaseWaveEventId(event: ReleaseWaveEvent): string {
  return createHash('sha256')
    .update(event.sourceRepository + '\n' + event.packageName + '\n' + event.version)
    .digest('hex');
}

/** Keep queue validation at the inbound trust boundary. */
function validateInput(input: {
  readonly event: ReleaseWaveEvent;
  readonly maximumRetries: number;
}): void {
  if (!Number.isInteger(input.maximumRetries) || input.maximumRetries < 1)
    throw new Error('Release-wave event queue retry budget must be a positive integer.');
  if (!/^@ankhorage\/[a-z0-9][a-z0-9-]*$/.test(input.event.packageName))
    throw new Error('Release-wave event package name is invalid.');
  if (!/^ankhorage\/[a-z0-9-]+$/.test(input.event.sourceRepository))
    throw new Error('Release-wave event source repository is invalid.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.event.version))
    throw new Error('Release-wave event version is invalid.');
}

/** Sort independently of arrival order for reproducible queue snapshots and plans. */
function compareEvents(left: DurableReleaseWaveEvent, right: DurableReleaseWaveEvent): number {
  return left.eventId.localeCompare(right.eventId);
}
