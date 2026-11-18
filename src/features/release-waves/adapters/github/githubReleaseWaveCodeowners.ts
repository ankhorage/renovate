import type { githubReleaseWaveClient } from './githubReleaseWaveClient.js';

/*** Read GitHub's effective CODEOWNERS file at an immutable base revision. */
export async function githubReleaseWaveCodeownersAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  revision: string,
): Promise<string | undefined> {
  const tree = await client.jsonAsync<{ readonly tree?: readonly { readonly path?: string }[] }>(
    '/repos/' + repository + '/git/trees/' + revision + '?recursive=1',
  );
  const paths = new Set(
    tree.tree?.flatMap((entry) => (entry.path === undefined ? [] : [entry.path])),
  );
  const path = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find((candidate) =>
    paths.has(candidate),
  );
  return path === undefined ? undefined : githubContentAsync(client, repository, path, revision);
}

/*** Prove every changed path has an individual owner among exact-head human approvers. */
export function githubReleaseWaveCodeownerApprovalPassed(
  files: readonly { readonly filename: string }[],
  codeowners: string | undefined,
  approvers: ReadonlySet<string>,
): boolean {
  return (
    codeowners !== undefined &&
    files.length > 0 &&
    files.every((file) => {
      const owners = codeownersForPath(codeowners, file.filename);
      return owners.length > 0 && owners.some((owner) => approvers.has(owner));
    })
  );
}

/*** Decode immutable GitHub Contents evidence. */
async function githubContentAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  path: string,
  revision: string,
): Promise<string> {
  const value = await client.jsonAsync<{ readonly content?: string; readonly encoding?: string }>(
    '/repos/' + repository + '/contents/' + path + '?ref=' + encodeURIComponent(revision),
  );
  if (value.encoding !== 'base64' || value.content === undefined)
    throw new Error('codeowners-missing');
  return Buffer.from(value.content, 'base64').toString('utf8');
}

/*** Apply ordered rules; team ownership fails closed because membership is not review evidence. */
function codeownersForPath(codeowners: string, path: string): readonly string[] {
  const matching = codeowners
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+#.*$/u, '')
        .trim()
        .split(/\s+/u),
    )
    .filter((parts) => parts.length >= 2 && !parts[0]?.startsWith('#'))
    .filter((parts) => {
      const [pattern] = parts;
      return pattern !== undefined && codeownersPattern(pattern, path);
    });
  const owners = matching.at(-1)?.slice(1) ?? [];
  return owners.flatMap((owner) =>
    owner.startsWith('@') && !owner.includes('/') ? [owner.slice(1)] : [],
  );
}

/*** Match a deliberately bounded CODEOWNERS glob grammar. */
function codeownersPattern(pattern: string, path: string): boolean {
  if (pattern.startsWith('!')) return false;
  const escaped = pattern
    .replace(/^\//u, '')
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '§§')
    .replace(/\*/gu, pattern.includes('/') ? '[^/]*' : '.*')
    .replace(/§§/gu, '.*')
    .replace(/\?/gu, '[^/]');
  return new RegExp('^' + escaped + (pattern.endsWith('/') ? '.*' : '') + '$', 'u').test(path);
}
