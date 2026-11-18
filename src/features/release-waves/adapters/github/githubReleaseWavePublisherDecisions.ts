import type {
  ChangesetReleaseDecision,
  ReleaseWaveRepository,
} from '../../../../types/releaseWave.js';

/*** Reject partial collection; only an explicit no-plan decision is an unchanged baseline. */
export function assertCompleteReleaseWavePublisherDecisions(
  selected: ReadonlyMap<string, ReleaseWaveRepository>,
  decisions: ReadonlyMap<string, ChangesetReleaseDecision>,
): void {
  const eligible = [...selected.values()].filter((repository) => repository.publishable);
  const expected = new Set(eligible.map((repository) => repository.fullName));
  if (expected.size === 0) throw new Error('Selected installation has no eligible publishers.');
  if (decisions.size !== expected.size || [...decisions.keys()].some((name) => !expected.has(name)))
    throw new Error(
      'Release-wave publisher decisions are incomplete for the selected installation.',
    );
  for (const repository of eligible) {
    const decision = decisions.get(repository.fullName);
    if (
      decision === undefined ||
      decision.revision !== repository.sourceRevision ||
      !/^[a-f0-9]{40}$/.test(decision.revision) ||
      !/^[a-f0-9]{64}$/.test(decision.statusHash)
    )
      throw new Error(
        'Release-wave publisher decision is not bound to a selected immutable source.',
      );
    if (
      decision.releasePlan !== undefined &&
      (decision.releasePlan.revision !== decision.revision ||
        decision.releasePlan.statusHash !== decision.statusHash)
    )
      throw new Error('Release-wave publisher plan does not match its collected status decision.');
  }
}
