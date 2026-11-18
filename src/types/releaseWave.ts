export type DependencyKind =
  'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';

export interface ReleaseWaveRepository {
  readonly archived: boolean;
  readonly bootstrapReady: boolean;
  readonly dependencies: Readonly<Record<DependencyKind, Readonly<Record<string, string>>>>;
  readonly excludedReason?: string;
  readonly fullName: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly private: boolean;
  readonly publishable: boolean;
  /** Immutable selected default-branch commit that supplied this profile. */
  readonly sourceRevision?: string;
}

export interface PublishedPackage {
  readonly name: string;
  readonly version: string;
}

/** A package-version decision emitted by the managed Changesets release planner. */
export interface ChangesetReleasePlan {
  readonly packageName: string;
  /** Immutable candidate revision whose clean checkout produced the status document. */
  readonly revision: string;
  readonly releases: readonly ChangesetRelease[];
  /** SHA-256 of the exact Changesets status document collected from the clean pinned checkout. */
  readonly statusHash?: string;
  readonly version: string;
}

/**
 * Exhaustive Changesets status evidence for one selected publishable source.
 *
 * An absent `releasePlan` is a verified unchanged baseline, not a missing
 * collection result.  The epoch writer requires one decision for every
 * eligible selected publisher before it can freeze a schedule.
 */
export interface ChangesetReleaseDecision {
  readonly releasePlan?: ChangesetReleasePlan;
  readonly revision: string;
  readonly statusHash: string;
}

/** Immutable local consumer checkout identity used to collect managed Changesets output. */
export interface ReleaseWaveCheckout {
  readonly path: string;
  readonly revision: string;
}

/** One source Changeset that contributes to a planned package publication. */
interface ChangesetRelease {
  readonly packageName: string;
  readonly type: 'major' | 'minor' | 'patch';
}

export interface ReleaseWaveNode {
  readonly dependencies: readonly string[];
  /** Exact upstream publications a grouped candidate must adopt before it can settle. */
  readonly expectedDependencies: readonly ReleaseWaveDependency[];
  /** Immutable release evidence decided before an external candidate is created. */
  readonly expectedPublication: ReleaseWavePublication | undefined;
  readonly packageName: string;
  readonly requiresNpmPublication: boolean;
  readonly repository: string;
}

/** One direct Ankhorage dependency and the immutable publication version planned for it. */
export interface ReleaseWaveDependency {
  readonly packageName: string;
  readonly version: string;
}

/** Exact publication version authorized by the managed Changeset/release planner. */
interface ReleaseWavePublication {
  readonly version: string;
}

export interface ReleaseWavePlan {
  readonly blocked: readonly string[];
  /** Immutable cohort identity persisted with the checkpoint to fence inventory and graph drift. */
  readonly cohort?: {
    readonly epochId: string;
    /** Immutable epoch identity; the mutable provider index revision is not a recovery fence. */
    readonly epochRevision: string;
    readonly inventoryId: string;
    readonly publisherEventIds: readonly string[];
  };
  readonly excluded: readonly string[];
  readonly nodes: readonly ReleaseWaveNode[];
  readonly pendingBootstrap: readonly string[];
  readonly runId: string;
  readonly waves: readonly (readonly string[])[];
}

export interface ReleaseWaveLedger {
  /** Candidate-scoped Changesets evidence, written before protected-release verification. */
  readonly candidatePublications?: Readonly<Record<string, ChangesetReleasePlan>>;
  readonly nodes: Readonly<
    Record<
      string,
      | 'blocked'
      | 'pending-bootstrap'
      | 'ready'
      | 'updating'
      | 'awaiting-review'
      | 'verified'
      | 'released'
      | 'failed'
    >
  >;
  /** Durable ownership and recovery metadata for in-flight repository operations. */
  readonly operations?: Readonly<Record<string, ReleaseWaveOperation>>;
  readonly runId: string;
}

export interface ReleaseWaveOperation {
  readonly fencingToken: string;
  readonly leaseExpiresAt: string;
  readonly operationId: string;
  readonly ownerId: string;
}

/** Actionable failure retained with the checkpoint so a later executor can safely recover. */
export interface ReleaseWaveFailure {
  readonly code: ReleaseWaveFailureCode;
  readonly diagnostic: string;
  readonly recoverable: boolean;
}

/** Stable, non-sensitive classes retained in a readable GitHub checkpoint. */
export type ReleaseWaveFailureCode =
  'checkpoint-conflict' | 'execution-failed' | 'verification-failed';
