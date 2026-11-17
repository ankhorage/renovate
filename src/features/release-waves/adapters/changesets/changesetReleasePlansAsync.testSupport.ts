import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*** Create a disposable committed package fixture for real Changesets collection tests. */
export async function changesetCheckoutFixtureAsync(): Promise<{
  readonly path: string;
  readonly removeAsync: () => Promise<void>;
  readonly revision: string;
}> {
  const path = await mkdtemp(join(tmpdir(), 'changeset-release-plan-test-'));
  await mkdir(join(path, '.changeset'));
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ name: '@ankhorage/example', version: '1.0.0' }),
  );
  await writeFile(
    join(path, '.changeset', 'config.json'),
    JSON.stringify({
      access: 'public',
      baseBranch: 'main',
      changelog: false,
      commit: false,
      fixed: [],
      ignore: [],
      linked: [],
      updateInternalDependencies: 'patch',
    }),
  );
  await writeFile(
    join(path, '.changeset', 'example.md'),
    "---\n'@ankhorage/example': patch\n---\n\nRelease.\n",
  );
  await commandAsync(['git', 'init', '--initial-branch=main'], path);
  await commandAsync(['git', 'add', '.'], path);
  await commandAsync(
    [
      'git',
      '-c',
      'user.email=test@example.test',
      '-c',
      'user.name=Test',
      'commit',
      '-m',
      'fixture',
    ],
    path,
  );
  return {
    path,
    removeAsync: () => rm(path, { force: true, recursive: true }),
    revision: await revisionAsync(path),
  };
}

/*** Run a fixture-only Git command without shell interpretation. */
async function commandAsync(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd });
  if ((await process.exited) !== 0) throw new Error('Fixture command failed.');
}

/*** Read the Git revision used as the adapter's immutable consumer checkout identity. */
async function revisionAsync(cwd: string): Promise<string> {
  const process = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd, stdout: 'pipe' });
  if ((await process.exited) !== 0) throw new Error('Fixture revision failed.');
  return (await new Response(process.stdout).text()).trim();
}
