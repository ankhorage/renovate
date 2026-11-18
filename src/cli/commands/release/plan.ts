import { readFile, writeFile } from 'node:fs/promises';

import { planReleaseWavesFromCheckoutsAsync } from '../../../features/release-waves/composition/planReleaseWavesFromCheckoutsAsync.js';
import type {
  PublishedPackage,
  ReleaseWaveCheckout,
  ReleaseWaveRepository,
} from '../../../types/releaseWave.js';

/*** Produce a durable, deterministic release-wave checkpoint from an externally collected installation inventory. */
export async function planReleaseWavesAsync(inputPath: string, outputPath: string): Promise<void> {
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  if (!isReleaseWaveInput(input)) throw new Error('Release-wave input is invalid.');
  const plan = await planReleaseWavesFromCheckoutsAsync(input);
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        ledger: {
          nodes: Object.fromEntries([
            ...plan.nodes.map((node) => [node.repository, 'ready'] as const),
            ...plan.pendingBootstrap.map(
              (repository) => [repository, 'pending-bootstrap'] as const,
            ),
            ...plan.blocked.map((entry) => [readRepository(entry), 'blocked'] as const),
          ]) as Readonly<Record<string, 'blocked' | 'pending-bootstrap' | 'ready'>>,
          runId: plan.runId,
        },
        plan,
      },
      null,
      2,
    ) + '\n',
  );
}

/*** Extract the repository key from a planner diagnostic. */
function readRepository(entry: string): string {
  const [repository] = entry.split(':', 1);
  if (repository === undefined)
    throw new Error('Release-wave diagnostic is missing its repository.');
  return repository;
}

/*** Narrow externally collected JSON to the coordinator input boundary. */
function isReleaseWaveInput(input: unknown): input is {
  readonly publishedPackages: readonly PublishedPackage[];
  readonly checkouts: Readonly<Record<string, ReleaseWaveCheckout>>;
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly runId: string;
} {
  return (
    typeof input === 'object' &&
    input !== null &&
    'publishedPackages' in input &&
    'checkouts' in input &&
    'repositories' in input &&
    'runId' in input &&
    Array.isArray(input.publishedPackages) &&
    Array.isArray(input.repositories) &&
    typeof input.checkouts === 'object' &&
    input.checkouts !== null &&
    typeof input.runId === 'string'
  );
}

const [inputPath, outputPath] = Bun.argv.slice(2);
if (inputPath === undefined || outputPath === undefined) {
  throw new Error('Usage: bun src/cli/commands/release/plan.ts <input-path> <output-path>');
}
await planReleaseWavesAsync(inputPath, outputPath);
