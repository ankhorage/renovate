import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChangesetReleasePlan, ReleaseWaveCheckout } from '../../../../types/releaseWave.js';

interface ChangesetStatus {
  readonly releases?: readonly ChangesetStatusRelease[];
}

interface ChangesetStatusRelease {
  readonly name?: string;
  readonly newVersion?: string;
  readonly type?: 'major' | 'minor' | 'patch';
}

/*** Collect immutable Changesets release plans by running status in each pinned consumer checkout. */
export async function changesetReleasePlansAsync(
  checkouts: Readonly<Record<string, ReleaseWaveCheckout>>,
): Promise<ReadonlyMap<string, ChangesetReleasePlan>> {
  const entries = await Promise.all(
    Object.entries(checkouts).map(
      async ([repository, checkout]) =>
        [repository, await changesetReleasePlanAsync(checkout)] as const,
    ),
  );
  return new Map(
    entries.flatMap(([repository, plan]) =>
      plan === undefined ? [] : [[repository, plan] as const],
    ),
  );
}

/*** Execute Changesets against one exact checkout and retain only a sole patch publication decision. */
async function changesetReleasePlanAsync(
  checkout: ReleaseWaveCheckout,
): Promise<ChangesetReleasePlan | undefined> {
  if ((await gitRevisionAsync(checkout.path)) !== checkout.revision) {
    throw new Error('Changesets checkout revision is not immutable.');
  }
  const directory = await mkdtemp(join(tmpdir(), 'ankhorage-changeset-status-'));
  const outputPath = join(directory, 'status.json');
  try {
    const command =
      Bun.which('changeset') ?? join(process.cwd(), 'node_modules', '.bin', 'changeset');
    const subprocess = Bun.spawn([command, 'status', '--output', outputPath], {
      cwd: checkout.path,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if ((await subprocess.exited) !== 0) {
      throw new Error(
        'Changesets status command failed: ' + (await new Response(subprocess.stderr).text()),
      );
    }
    if ((await gitRevisionAsync(checkout.path)) !== checkout.revision) {
      throw new Error('Changesets checkout revision changed during collection.');
    }
    return releasePlan(JSON.parse(await readFile(outputPath, 'utf8')) as ChangesetStatus);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/*** Resolve the checkout revision through Git rather than trusting a mutable filesystem label. */
async function gitRevisionAsync(path: string): Promise<string> {
  const subprocess = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: path, stdout: 'pipe' });
  if ((await subprocess.exited) !== 0)
    throw new Error('Changesets checkout is not a Git revision.');
  return (await new Response(subprocess.stdout).text()).trim();
}

/*** Accept exactly one managed patch publication from the authoritative Changesets status document. */
function releasePlan(status: ChangesetStatus): ChangesetReleasePlan | undefined {
  const releases = status.releases ?? [];
  if (releases.length !== 1) return undefined;
  const [release] = releases;
  if (release?.name === undefined || release.newVersion === undefined) {
    return undefined;
  }
  if (release.type !== 'patch') return undefined;
  return {
    packageName: release.name,
    releases: [{ packageName: release.name, type: release.type }],
    version: release.newVersion,
  };
}
