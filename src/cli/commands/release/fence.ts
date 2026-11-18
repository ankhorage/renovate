import { releaseWaveMutationFenceFromEnvironment } from '../../../features/release-waves/composition/releaseWaveMutationFenceFromEnvironment.js';

const [action, mutator] = Bun.argv.slice(2);
const fence = releaseWaveMutationFenceFromEnvironment(process.env);
const now = new Date();

if (action === 'acquire' && (mutator === 'legacy' || mutator === 'coordinator')) {
  await fence.acquireReleaseWaveMutationLeaseAsync({
    leaseId: leaseId(),
    mutator,
    now,
    ttlMilliseconds: leaseTtlMilliseconds(),
  });
} else if (action === 'release') {
  await fence.releaseReleaseWaveMutationLeaseAsync({ leaseId: leaseId(), now });
} else if (action === 'cutover') {
  process.stdout.write(
    JSON.stringify(await fence.beginReleaseWaveCoordinatorCutoverAsync({ now })) + '\n',
  );
} else if (action === 'rollback') {
  await fence.rollbackReleaseWaveCoordinatorCutoverAsync({ now });
} else {
  throw new Error('Usage: fence.ts <acquire legacy|acquire coordinator|release|cutover|rollback>');
}

/*** Read the GitHub-run-derived durable lease identifier without accepting an ambient fallback. */
function leaseId(): string {
  const value = process.env.RELEASE_WAVE_MUTATION_LEASE_ID;
  if (value === undefined || value.length === 0)
    throw new Error('Release-wave mutation lease identifier is required.');
  return value;
}

/*** Bound a workflow claim so an interrupted run can be recovered after its documented job limit. */
function leaseTtlMilliseconds(): number {
  const value = Number(process.env.RELEASE_WAVE_MUTATION_LEASE_TTL_MILLISECONDS ?? '21600000');
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Release-wave mutation lease duration is invalid.');
  return value;
}
