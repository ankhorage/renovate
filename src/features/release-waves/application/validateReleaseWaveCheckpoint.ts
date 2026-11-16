import type {
  ReleaseWaveLedger,
  ReleaseWaveOperation,
  ReleaseWavePlan,
} from '../../../types/releaseWave.js';
import type { ReleaseWaveCheckpoint } from '../ports/releaseWaveCheckpoint.js';

/*** Validate immutable plan identity, enrollment, statuses, and persisted operation records. */
export function validateReleaseWaveCheckpoint(
  plan: ReleaseWavePlan,
  checkpoint: ReleaseWaveCheckpoint,
): ReleaseWaveCheckpoint {
  if (
    checkpoint.ledger.runId !== plan.runId ||
    checkpoint.plan.runId !== plan.runId ||
    JSON.stringify(plan) !== JSON.stringify(checkpoint.plan)
  )
    throw new Error(
      'Persisted release-wave checkpoint plan identity does not match this execution.',
    );
  const enrolled = new Set(plan.nodes.map((node) => node.repository));
  const statuses = Object.entries(checkpoint.ledger.nodes);
  if (
    statuses.length !== enrolled.size ||
    statuses.some(([repository, status]) => !enrolled.has(repository) || !isStatus(status))
  )
    throw new Error('Persisted release-wave checkpoint repository enrollment is invalid.');
  if (
    Object.entries(checkpoint.ledger.operations ?? {}).some(
      ([repository, operation]) =>
        !enrolled.has(repository) ||
        operation.operationId !== releaseWaveOperationId(plan.runId, repository) ||
        !isOperation(operation),
    )
  )
    throw new Error('Persisted release-wave checkpoint operation identity is invalid.');
  return checkpoint;
}

/*** Keep operation identity stable across owners and retries so external reconciliation is idempotent. */
export function releaseWaveOperationId(runId: string, repository: string): string {
  return runId + ':' + repository;
}

/*** Read an untrusted checkpoint node without direct object-key injection. */
export function releaseWaveNodeStatus(
  ledger: ReleaseWaveLedger,
  repository: string,
): ReleaseWaveLedger['nodes'][string] | undefined {
  return Object.entries(ledger.nodes).find(([name]) => name === repository)?.[1];
}

/*** Read an untrusted checkpoint operation without direct object-key injection. */
export function releaseWaveOperation(
  ledger: ReleaseWaveLedger,
  repository: string,
): ReleaseWaveOperation | undefined {
  return Object.entries(ledger.operations ?? {}).find(([name]) => name === repository)?.[1];
}

/*** Validate the only durable status vocabulary accepted from GitHub Contents. */
function isStatus(value: string): value is ReleaseWaveLedger['nodes'][string] {
  return [
    'blocked',
    'pending-bootstrap',
    'ready',
    'updating',
    'awaiting-review',
    'verified',
    'released',
    'failed',
  ].includes(value);
}

/*** Validate operation fields before they govern a resumed external side effect. */
function isOperation(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'leaseExpiresAt' in value &&
    'fencingToken' in value &&
    'operationId' in value &&
    'ownerId' in value &&
    typeof value.leaseExpiresAt === 'string' &&
    typeof value.fencingToken === 'string' &&
    typeof value.operationId === 'string' &&
    typeof value.ownerId === 'string'
  );
}
