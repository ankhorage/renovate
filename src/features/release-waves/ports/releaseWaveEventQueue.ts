/** A received package-release dispatch, normalized before durable storage. */
export interface ReleaseWaveEvent {
  readonly npmArtifactIntegrity: string;
  readonly packageName: string;
  readonly releaseId: string;
  readonly releaseTag: string;
  readonly sourceRepository: string;
  readonly version: string;
}

/** A durable event adds a deterministic id and acknowledgement state to an inbound dispatch. */
export interface DurableReleaseWaveEvent extends ReleaseWaveEvent {
  readonly eventId: string;
  readonly acknowledgedRunId?: string;
}

/** The queue document is deliberately revisioned so duplicate dispatches cannot lose publications. */
export interface ReleaseWaveEventQueue {
  /** Exact settled identities retained after event-body compaction so retries cannot resurrect work. */
  readonly acknowledgedEvents?: Readonly<Record<string, string>>;
  readonly events: readonly DurableReleaseWaveEvent[];
}

/** Port for one durable, compare-and-swap event queue. */
export interface ReleaseWaveEventQueuePort {
  loadReleaseWaveEventQueueAsync(): Promise<
    { readonly queue: ReleaseWaveEventQueue; readonly revision?: string } | undefined
  >;
  saveReleaseWaveEventQueueAsync(
    queue: ReleaseWaveEventQueue,
    expectedRevision: string | undefined,
  ): Promise<{ readonly queue: ReleaseWaveEventQueue; readonly revision?: string }>;
}

/** Signal that another writer changed the queue before this writer could persist its transition. */
export class ReleaseWaveEventQueueConflictError extends Error {
  public constructor() {
    super('Release-wave event queue revision conflict.');
    this.name = 'ReleaseWaveEventQueueConflictError';
  }
}

/** Identify a revision conflict without coupling callers to a concrete persistence adapter. */
export function isReleaseWaveEventQueueConflict(error: unknown): boolean {
  return error instanceof ReleaseWaveEventQueueConflictError;
}
