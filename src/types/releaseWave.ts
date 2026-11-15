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
}

export interface PublishedPackage {
  readonly name: string;
  readonly version: string;
}

export interface ReleaseWaveNode {
  readonly dependencies: readonly string[];
  readonly packageName: string;
  readonly repository: string;
}

export interface ReleaseWavePlan {
  readonly blocked: readonly string[];
  readonly excluded: readonly string[];
  readonly nodes: readonly ReleaseWaveNode[];
  readonly pendingBootstrap: readonly string[];
  readonly runId: string;
  readonly waves: readonly (readonly string[])[];
}

export interface ReleaseWaveLedger {
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
  readonly runId: string;
}
