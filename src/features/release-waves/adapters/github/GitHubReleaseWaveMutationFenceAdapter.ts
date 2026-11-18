import type {
  ReleaseWaveCutoverState,
  ReleaseWaveMutationFencePort,
  ReleaseWaveMutationLease,
  ReleaseWaveMutator,
} from '../../ports/releaseWaveMutationFence.js';

interface GitHubContentsClient {
  readonly repos: {
    readonly createOrUpdateFileContents: (input: {
      readonly branch: string;
      readonly content: string;
      readonly message: string;
      readonly owner: string;
      readonly path: string;
      readonly repo: string;
      readonly sha?: string;
    }) => Promise<{ readonly data: { readonly content: { readonly sha: string } } }>;
    readonly getContent: (input: {
      readonly owner: string;
      readonly path: string;
      readonly ref: string;
      readonly repo: string;
    }) => Promise<{ readonly data: GitHubFile }>;
  };
}

interface GitHubFile {
  readonly content?: string;
  readonly encoding?: string;
  readonly sha: string;
  readonly type: string;
}

interface GitHubReleaseWaveMutationFenceAdapterInput {
  readonly branch: string;
  readonly client: GitHubContentsClient;
  readonly owner: string;
  readonly repository: string;
}

interface ReleaseWaveMutationFence {
  readonly coordinatorMutationRecorded: boolean;
  readonly legacyAdmissionOpen: boolean;
  readonly leases: Readonly<Record<string, ReleaseWaveMutationLease>>;
  readonly mode: ReleaseWaveMutator;
  readonly version: 1;
}

interface RevisionedReleaseWaveMutationFence {
  readonly fence: ReleaseWaveMutationFence;
  readonly revision?: string;
}

const maximumRetries = 4;

/*** Persist the global old/new mutator boundary with GitHub Contents compare-and-swap. */
export function GitHubReleaseWaveMutationFenceAdapter(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
): ReleaseWaveMutationFencePort {
  return {
    acquireReleaseWaveMutationLeaseAsync: (lease) =>
      acquireReleaseWaveMutationLeaseAsync(input, lease),
    assertReleaseWaveMutationLeaseAsync: (lease) =>
      assertReleaseWaveMutationLeaseAsync(input, lease),
    beginReleaseWaveCoordinatorCutoverAsync: ({ now }) =>
      beginReleaseWaveCoordinatorCutoverAsync(input, now),
    recordReleaseWaveCoordinatorMutationAsync: (lease) =>
      recordReleaseWaveCoordinatorMutationAsync(input, lease),
    releaseReleaseWaveMutationLeaseAsync: (lease) =>
      releaseReleaseWaveMutationLeaseAsync(input, lease),
    rollbackReleaseWaveCoordinatorCutoverAsync: ({ now }) =>
      rollbackReleaseWaveCoordinatorCutoverAsync(input, now),
  };
}

/** Acquire an admitted lease only after atomically observing the current mutator mode. */
async function acquireReleaseWaveMutationLeaseAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  lease: {
    readonly leaseId: string;
    readonly mutator: ReleaseWaveMutator;
    readonly now: Date;
    readonly ttlMilliseconds: number;
  },
): Promise<ReleaseWaveMutationLease> {
  validateLeaseInput(lease);
  const acquired = releaseWaveMutationLease(lease);
  await transitionReleaseWaveMutationFenceAsync(input, lease.now, (fence) => {
    assertMutatorAdmitted(fence, lease.mutator);
    const existing = fence.leases[lease.leaseId];
    if (existing !== undefined && existing.mutator !== lease.mutator)
      throw new Error('Release-wave mutation lease conflicts with its existing mutator.');
    return { ...fence, leases: { ...fence.leases, [lease.leaseId]: acquired } };
  });
  return acquired;
}

/** Re-read the durable state immediately before a side effect rather than trusting an earlier admission. */
async function assertReleaseWaveMutationLeaseAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  lease: { readonly leaseId: string; readonly mutator: ReleaseWaveMutator; readonly now: Date },
): Promise<void> {
  const loaded = await loadReleaseWaveMutationFenceAsync(input);
  const fence = discardExpiredLeases(loaded.fence, lease.now);
  assertMutatorAdmitted(fence, lease.mutator);
  const active = fence.leases[lease.leaseId];
  if (active?.mutator !== lease.mutator)
    throw new Error('Release-wave mutation lease is not active for this mutator.');
}

/** Close legacy admission first; only a fully drained fence atomically admits the coordinator. */
async function beginReleaseWaveCoordinatorCutoverAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  now: Date,
): Promise<ReleaseWaveCutoverState> {
  const transitioned = await transitionReleaseWaveMutationFenceAsync(input, now, (fence) => {
    if (fence.mode === 'coordinator') return fence;
    const closed = { ...fence, legacyAdmissionOpen: false };
    return Object.keys(closed.leases).length === 0 ? { ...closed, mode: 'coordinator' } : closed;
  });
  return { activeLeases: Object.values(transitioned.leases), mode: transitioned.mode };
}

/** Durable evidence of a coordinator side effect makes rollback fail closed instead of replaying legacy work. */
async function recordReleaseWaveCoordinatorMutationAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  lease: { readonly leaseId: string; readonly now: Date },
): Promise<void> {
  await transitionReleaseWaveMutationFenceAsync(input, lease.now, (fence) => {
    assertMutatorAdmitted(fence, 'coordinator');
    if (fence.leases[lease.leaseId]?.mutator !== 'coordinator')
      throw new Error('Release-wave coordinator mutation requires an active coordinator lease.');
    return { ...fence, coordinatorMutationRecorded: true };
  });
}

/** Release a completed claim without changing the selected mutator. */
async function releaseReleaseWaveMutationLeaseAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  lease: { readonly leaseId: string; readonly now: Date },
): Promise<void> {
  await transitionReleaseWaveMutationFenceAsync(input, lease.now, (fence) => {
    if (fence.leases[lease.leaseId] === undefined) return fence;
    const { [lease.leaseId]: _released, ...leases } = fence.leases;
    return { ...fence, leases };
  });
}

/** Return to legacy only before any coordinator mutation was durably authorized. */
async function rollbackReleaseWaveCoordinatorCutoverAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  now: Date,
): Promise<void> {
  await transitionReleaseWaveMutationFenceAsync(input, now, (fence) => {
    if (fence.mode !== 'coordinator')
      throw new Error('Release-wave coordinator cutover is not active.');
    if (Object.keys(fence.leases).length > 0)
      throw new Error('Release-wave coordinator cutover still has active mutations.');
    if (fence.coordinatorMutationRecorded)
      throw new Error('Release-wave coordinator cutover cannot roll back after a mutation.');
    return { ...fence, legacyAdmissionOpen: true, mode: 'legacy' };
  });
}

/** Apply a pure state transition through bounded CAS retries so parallel dispatches cannot overwrite one another. */
async function transitionReleaseWaveMutationFenceAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  now: Date,
  transition: (fence: ReleaseWaveMutationFence) => ReleaseWaveMutationFence,
): Promise<ReleaseWaveMutationFence> {
  for (const _attempt of Array.from({ length: maximumRetries })) {
    const loaded = await loadReleaseWaveMutationFenceAsync(input);
    const next = transition(discardExpiredLeases(loaded.fence, now));
    try {
      await saveReleaseWaveMutationFenceAsync(input, next, loaded.revision);
      return next;
    } catch (error) {
      if (!isGitHubConflict(error)) throw error;
    }
  }
  throw new Error('Release-wave mutation fence could not acquire a stable revision.');
}

/** Load the canonical state document, treating an absent document as the default-off legacy mode. */
async function loadReleaseWaveMutationFenceAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
): Promise<RevisionedReleaseWaveMutationFence> {
  try {
    const response = await input.client.repos.getContent({
      owner: input.owner,
      path: releaseWaveMutationFencePath(),
      ref: input.branch,
      repo: input.repository,
    });
    if (
      response.data.type !== 'file' ||
      response.data.encoding !== 'base64' ||
      !response.data.content
    )
      throw new Error('Release-wave mutation fence must be a base64 GitHub file.');
    return {
      fence: parseReleaseWaveMutationFence(
        Buffer.from(response.data.content, 'base64').toString('utf8'),
      ),
      revision: response.data.sha,
    };
  } catch (error) {
    if (githubFailureStatus(error) === 404) return { fence: defaultReleaseWaveMutationFence() };
    throw error;
  }
}

/** Save only against the observed state revision, including a first-write race. */
async function saveReleaseWaveMutationFenceAsync(
  input: GitHubReleaseWaveMutationFenceAdapterInput,
  fence: ReleaseWaveMutationFence,
  expectedRevision: string | undefined,
): Promise<void> {
  await input.client.repos.createOrUpdateFileContents({
    branch: input.branch,
    content: Buffer.from(JSON.stringify(fence) + '\n').toString('base64'),
    message: 'chore(release-wave): update mutation fence',
    owner: input.owner,
    path: releaseWaveMutationFencePath(),
    repo: input.repository,
    ...(expectedRevision === undefined ? {} : { sha: expectedRevision }),
  });
}

/** Construct the only implicit state: legacy remains the default until an operator drains it. */
function defaultReleaseWaveMutationFence(): ReleaseWaveMutationFence {
  return {
    coordinatorMutationRecorded: false,
    legacyAdmissionOpen: true,
    leases: {},
    mode: 'legacy',
    version: 1,
  };
}

/** Remove elapsed leases before a new owner can safely resume an interrupted workflow. */
function discardExpiredLeases(
  fence: ReleaseWaveMutationFence,
  now: Date,
): ReleaseWaveMutationFence {
  const leases = Object.fromEntries(
    Object.entries(fence.leases).filter(([, lease]) => Date.parse(lease.expiresAt) > now.getTime()),
  );
  return Object.keys(leases).length === Object.keys(fence.leases).length
    ? fence
    : { ...fence, leases };
}

/** Require the durable mode and its explicit legacy admission flag before granting work. */
function assertMutatorAdmitted(fence: ReleaseWaveMutationFence, mutator: ReleaseWaveMutator): void {
  if (fence.mode !== mutator || (mutator === 'legacy' && !fence.legacyAdmissionOpen))
    throw new Error('Release-wave mutation fence denies ' + mutator + ' admission.');
}

/** Validate untrusted workflow identifiers and duration before they become durable state. */
function validateLeaseInput(input: {
  readonly leaseId: string;
  readonly now: Date;
  readonly ttlMilliseconds: number;
}): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(input.leaseId))
    throw new Error('Release-wave mutation lease identifier is invalid.');
  if (!Number.isFinite(input.ttlMilliseconds) || input.ttlMilliseconds <= 0)
    throw new Error('Release-wave mutation lease duration is invalid.');
  if (Number.isNaN(input.now.getTime()))
    throw new Error('Release-wave mutation lease clock is invalid.');
}

/** Create an immutable expiry timestamp that can be reconstructed after a workflow restart. */
function releaseWaveMutationLease(input: {
  readonly leaseId: string;
  readonly mutator: ReleaseWaveMutator;
  readonly now: Date;
  readonly ttlMilliseconds: number;
}): ReleaseWaveMutationLease {
  return {
    expiresAt: new Date(input.now.getTime() + input.ttlMilliseconds).toISOString(),
    leaseId: input.leaseId,
    mutator: input.mutator,
  };
}

/** Keep the state file independent from checkpoint and event-queue documents. */
function releaseWaveMutationFencePath(): string {
  return '.github/release-wave-mutation-fence.json';
}

/** Decode and validate every persisted field before it can grant a mutator permission. */
function parseReleaseWaveMutationFence(source: string): ReleaseWaveMutationFence {
  const value: unknown = JSON.parse(source);
  if (!isReleaseWaveMutationFence(value))
    throw new Error('Release-wave mutation fence has an invalid envelope.');
  return value;
}

/** Narrow untrusted JSON to the exact durable state schema. */
function isReleaseWaveMutationFence(value: unknown): value is ReleaseWaveMutationFence {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return (
    record.version === 1 &&
    (record.mode === 'legacy' || record.mode === 'coordinator') &&
    typeof record.legacyAdmissionOpen === 'boolean' &&
    typeof record.coordinatorMutationRecorded === 'boolean' &&
    typeof record.leases === 'object' &&
    record.leases !== null &&
    Object.entries(record.leases).every(([leaseId, lease]) =>
      isReleaseWaveMutationLease(leaseId, lease),
    )
  );
}

/** Validate each lease identity, family, and finite timestamp before honoring it. */
function isReleaseWaveMutationLease(
  leaseId: string,
  value: unknown,
): value is ReleaseWaveMutationLease {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(leaseId) &&
    typeof value === 'object' &&
    value !== null &&
    (value as ReleaseWaveMutationLease).leaseId === leaseId &&
    ((value as ReleaseWaveMutationLease).mutator === 'legacy' ||
      (value as ReleaseWaveMutationLease).mutator === 'coordinator') &&
    typeof (value as ReleaseWaveMutationLease).expiresAt === 'string' &&
    !Number.isNaN(Date.parse((value as ReleaseWaveMutationLease).expiresAt))
  );
}

/** Identify only GitHub's documented optimistic-contention responses as retryable. */
function isGitHubConflict(error: unknown): boolean {
  const status = githubFailureStatus(error);
  return status === 409 || status === 422;
}

/** Read an HTTP-like provider status without coupling the port to Octokit. */
function githubFailureStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { readonly status?: number }).status
    : undefined;
}
