/** The immutable publisher evidence which scopes one pre-publish snapshot request. */
export interface ReleaseWavePublisherSnapshotRequest {
  readonly changesetsStatusHash: string;
  readonly requestId: string;
  readonly sourceRepository: string;
  readonly sourceSha: string;
}

/** The durable acknowledgement consumed by the publisher before Changesets versioning. */
export interface ReleaseWavePublisherSnapshotAck extends ReleaseWavePublisherSnapshotRequest {
  readonly epochId: string;
}

/** Persist and recover request-bound acknowledgements independently from the mutable epoch index. */
export interface ReleaseWavePublisherSnapshotAckPort {
  loadReleaseWavePublisherSnapshotAckAsync(
    requestId: string,
  ): Promise<ReleaseWavePublisherSnapshotAck | undefined>;
  saveReleaseWavePublisherSnapshotAckAsync(
    ack: ReleaseWavePublisherSnapshotAck,
  ): Promise<ReleaseWavePublisherSnapshotAck>;
}
