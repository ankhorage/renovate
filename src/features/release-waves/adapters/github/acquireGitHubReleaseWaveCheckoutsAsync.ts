import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseWaveCheckout, ReleaseWaveRepository } from '../../../../types/releaseWave.js';

/*** Acquire clean detached checkouts for every eligible selected publisher and remove only that run's directory. */
export async function acquireGitHubReleaseWaveCheckoutsAsync<T>(input: {
  readonly repositories: readonly ReleaseWaveRepository[];
  readonly token: string;
  readonly useAsync: (checkouts: Readonly<Record<string, ReleaseWaveCheckout>>) => Promise<T>;
}): Promise<T> {
  if (!input.token)
    throw new Error('Release-wave checkout acquisition requires an installation token.');
  const root = await mkdtemp(join(tmpdir(), 'ankhorage-release-wave-'));
  try {
    const eligible = input.repositories.filter((repository) => repository.publishable);
    if (eligible.length === 0) throw new Error('Selected installation has no eligible publishers.');
    const checkouts = Object.fromEntries(
      await Promise.all(
        eligible.map(
          async (repository) =>
            [repository.fullName, await checkoutAsync(root, repository, input.token)] as const,
        ),
      ),
    );
    return await input.useAsync(checkouts);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

/*** Acquire one candidate checkout with an explicit caller-owned cleanup operation. */
export async function acquireGitHubReleaseWaveCheckoutAsync(input: {
  readonly repository: ReleaseWaveRepository;
  readonly token: string;
}): Promise<ReleaseWaveCheckout & { readonly cleanupAsync: () => Promise<void> }> {
  if (!input.token)
    throw new Error('Release-wave checkout acquisition requires an installation token.');
  const root = await mkdtemp(join(tmpdir(), 'ankhorage-release-wave-candidate-'));
  try {
    const checkout = await checkoutAsync(root, input.repository, input.token);
    return { ...checkout, cleanupAsync: () => rm(root, { force: true, recursive: true }) };
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

/*** Fetch one immutable revision without exposing the installation token in a remote URL or command arguments. */
async function checkoutAsync(
  root: string,
  repository: ReleaseWaveRepository,
  token: string,
): Promise<ReleaseWaveCheckout> {
  if (repository.sourceRevision === undefined || !/^[a-f0-9]{40}$/.test(repository.sourceRevision))
    throw new Error('Selected publisher has no immutable source revision.');
  const path = join(root, repository.fullName.replace('/', '--'));
  const environment = gitEnvironment(token);
  await gitAsync(['init', path], root, environment);
  await gitAsync(
    ['remote', 'add', 'origin', 'https://github.com/' + repository.fullName + '.git'],
    path,
    environment,
  );
  await gitAsync(['fetch', '--depth=1', 'origin', repository.sourceRevision], path, environment);
  await gitAsync(['checkout', '--detach', 'FETCH_HEAD'], path, environment);
  const [revision, status] = await Promise.all([
    gitOutputAsync(['rev-parse', 'HEAD'], path, environment),
    gitOutputAsync(
      ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'],
      path,
      environment,
    ),
  ]);
  if (revision !== repository.sourceRevision)
    throw new Error('Acquired checkout revision differs from selected source revision.');
  if (status.length > 0) throw new Error('Acquired checkout is dirty.');
  return { path, revision };
}

/*** Scope the HTTP authorization header to child Git only; it never becomes repository configuration. */
function gitEnvironment(token: string): Record<string, string | undefined> {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0:
      'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64'),
  };
}

/*** Execute a Git operation and preserve provider/acquisition failures rather than synthesizing a checkout. */
async function gitAsync(
  args: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const process = Bun.spawn(['git', ...args], { cwd, env, stderr: 'pipe' });
  if ((await process.exited) !== 0)
    throw new Error(
      'Release-wave checkout acquisition failed: ' + (await new Response(process.stderr).text()),
    );
}

/*** Read one successful Git command as immutable checkout evidence. */
async function gitOutputAsync(
  args: readonly string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const process = Bun.spawn(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if ((await process.exited) !== 0)
    throw new Error(
      'Release-wave checkout inspection failed: ' + (await new Response(process.stderr).text()),
    );
  return (await new Response(process.stdout).text()).trim();
}
