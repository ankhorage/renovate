import type { githubReleaseWaveClient } from './githubReleaseWaveClient.js';

/*** Read GitHub's effective CODEOWNERS file at an immutable base revision. */
export async function githubReleaseWaveCodeownersAsync(
  client: ReturnType<typeof githubReleaseWaveClient>,
  repository: string,
  revision: string,
): Promise<string | undefined> {
  const tree = await client.jsonAsync<{
    readonly tree?: readonly { readonly path?: string }[];
    readonly truncated?: boolean;
  }>('/repos/' + repository + '/git/trees/' + revision + '?recursive=1');
  if (tree.truncated === true) return undefined;
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
  files: readonly { readonly filename: string; readonly previous_filename?: string }[],
  codeowners: string | undefined,
  approvers: ReadonlySet<string>,
): boolean {
  return (
    codeowners !== undefined &&
    files.length > 0 &&
    hasSupportedCodeownersGrammar(codeowners) &&
    files.every((file) =>
      [file.filename, file.previous_filename]
        .filter((path): path is string => path !== undefined)
        .every((path) => {
          const owners = codeownersForPath(codeowners, path);
          return owners?.some((owner) => approvers.has(owner)) === true;
        }),
    )
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
function codeownersForPath(codeowners: string, path: string): readonly string[] | undefined {
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
  if (owners.length === 0 || owners.some((owner) => !isIndividualOwner(owner))) return undefined;
  return owners.map((owner) => owner.slice(1));
}

/*** Match a deliberately bounded CODEOWNERS glob grammar. */
function codeownersPattern(pattern: string, path: string): boolean {
  if (!isSupportedPattern(pattern)) return false;
  const escaped = pattern
    .replace(/^\//u, '')
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '§§')
    .replace(/\*/gu, pattern.includes('/') ? '[^/]*' : '.*')
    .replace(/§§/gu, '.*')
    .replace(/\?/gu, '[^/]');
  return new RegExp('^' + escaped + (pattern.endsWith('/') ? '.*' : '') + '$', 'u').test(path);
}

/*** Refuse a policy file whose matcher grammar cannot be authoritatively evaluated here. */
function hasSupportedCodeownersGrammar(codeowners: string): boolean {
  return codeowners
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+#.*$/u, '')
        .trim()
        .split(/\s+/u),
    )
    .filter((parts) => parts.length >= 2 && !parts[0]?.startsWith('#'))
    .every(([pattern]) => pattern !== undefined && isSupportedPattern(pattern));
}

/*** Keep the locally evaluated grammar intentionally smaller than GitHub's full syntax. */
function isSupportedPattern(pattern: string): boolean {
  return !pattern.startsWith('!') && !/[[\]\\]/u.test(pattern);
}

/*** Accept only GitHub individual owners; team membership is unavailable at this evidence boundary. */
function isIndividualOwner(owner: string): boolean {
  return /^@[A-Za-z0-9-]+$/u.test(owner);
}
