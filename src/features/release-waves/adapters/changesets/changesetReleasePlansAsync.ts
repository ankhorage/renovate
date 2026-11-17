import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inc, valid } from 'semver';

import type { ChangesetReleasePlan, ReleaseWaveCheckout } from '../../../../types/releaseWave.js';

interface ChangesetStatus {
  readonly releases?: readonly ChangesetStatusRelease[];
}

interface ChangesetStatusRelease {
  readonly changesets?: readonly string[];
  readonly name?: string;
  readonly newVersion?: string;
  readonly oldVersion?: string;
  readonly type?: 'major' | 'minor' | 'patch';
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
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
    const [status, manifest] = await Promise.all([
      readFile(outputPath, 'utf8').then((content) => JSON.parse(content) as ChangesetStatus),
      readFile(join(checkout.path, 'package.json'), 'utf8').then(
        (content) => JSON.parse(content) as PackageManifest,
      ),
    ]);
    return releasePlan(status, manifest);
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
function releasePlan(
  status: ChangesetStatus,
  manifest: PackageManifest,
): ChangesetReleasePlan | undefined {
  const releases = status.releases ?? [];
  if (releases.length !== 1) return undefined;
  const [release] = releases;
  if (
    release?.name === undefined ||
    release.newVersion === undefined ||
    manifest.name === undefined ||
    manifest.version === undefined ||
    valid(manifest.version) === null ||
    valid(release.newVersion) === null
  ) {
    return undefined;
  }
  if (!isSolePatchRelease(release, manifest.name, manifest.version)) return undefined;
  return {
    packageName: release.name,
    releases: [{ packageName: release.name, type: 'patch' }],
    version: release.newVersion,
  };
}

/** Ensure Changesets chose one patch from this exact package version. */
function isSolePatchRelease(
  release: ChangesetStatusRelease,
  packageName: string,
  packageVersion: string,
): boolean {
  return (
    release.type === 'patch' &&
    release.name === packageName &&
    release.oldVersion === packageVersion &&
    release.newVersion === inc(packageVersion, 'patch') &&
    release.changesets?.length === 1
  );
}
