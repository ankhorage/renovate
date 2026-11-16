import type { GitHubNpmReleaseWaveExecutionAdapterInput } from './GitHubNpmReleaseWaveExecutionAdapter.js';

type GitHubCollectionProperty = 'check_runs' | 'statuses' | 'workflow_runs';

interface GitHubCollection<T> {
  readonly check_runs?: readonly T[];
  readonly statuses?: readonly T[];
  readonly workflow_runs?: readonly T[];
}

/*** Build the bounded authenticated GitHub client used by the release-wave adapter. */
export function githubReleaseWaveClient(input: GitHubNpmReleaseWaveExecutionAdapterInput) {
  return {
    jsonAsync: <T>(path: string): Promise<T> => jsonAsync<T>(input, path),
    pagesAsync: <T>(path: string, property?: GitHubCollectionProperty): Promise<readonly T[]> =>
      pagesAsync<T>(input, path, property),
    requestAsync: (path: string, init: RequestInit = {}): Promise<Response> =>
      requestAsync(input, path, init),
  };
}

/*** Paginate GitHub REST responses with a finite trusted sequence. */
async function pagesAsync<T>(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
  property?: GitHubCollectionProperty,
): Promise<readonly T[]> {
  const values: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await jsonAsync<T[] | GitHubCollection<T>>(
      input,
      path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page,
    );
    const entries = Array.isArray(value) ? value : collection(value, property);
    values.push(...entries);
    if (entries.length < 100) return values;
  }
  throw new Error('pagination-incomplete');
}

/** Reject an unexpected REST envelope instead of silently treating provider evidence as empty. */
function collection<T>(
  value: GitHubCollection<T>,
  property: GitHubCollectionProperty | undefined,
): readonly T[] {
  if (property === 'check_runs' && value.check_runs !== undefined) return value.check_runs;
  if (property === 'statuses' && value.statuses !== undefined) return value.statuses;
  if (property === 'workflow_runs' && value.workflow_runs !== undefined) return value.workflow_runs;
  throw new Error('collection-missing');
}

/*** Send authenticated GitHub requests while reducing failures to safe classifications. */
async function requestAsync(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await input.requestAsync(input.apiBaseUrl + path, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + input.token,
      ...init.headers,
    },
  });
  if (response.ok) return response;
  throw new Error(
    response.status === 401
      ? 'credentials-expired'
      : response.status === 429 ||
          response.headers.get('retry-after') !== null ||
          response.headers.get('x-ratelimit-remaining') === '0'
        ? 'rate-limited'
        : response.status === 403
          ? 'credentials-or-policy'
          : 'provider-failed',
  );
}

/*** Decode a GitHub JSON response. */
async function jsonAsync<T>(
  input: GitHubNpmReleaseWaveExecutionAdapterInput,
  path: string,
): Promise<T> {
  return (await requestAsync(input, path)).json() as Promise<T>;
}
