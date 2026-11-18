import { GitHubReleaseWaveMutationFenceAdapter } from '../adapters/github/GitHubReleaseWaveMutationFenceAdapter.js';

/*** Compose the mutation fence independently so workflow admission and coordinator execution share one state document. */
export function releaseWaveMutationFenceFromEnvironment(environment: NodeJS.ProcessEnv) {
  const configuration = releaseWaveMutationFenceConfiguration(environment);
  return GitHubReleaseWaveMutationFenceAdapter({
    branch: configuration.branch,
    client: {
      repos: {
        createOrUpdateFileContents: (input) => saveGitHubContentAsync(configuration, input),
        getContent: (input) => loadGitHubContentAsync(configuration, input),
      },
    },
    owner: 'ankhorage',
    repository: 'renovate',
  });
}

/*** Read only the configuration required to access the shared durable fence. */
function releaseWaveMutationFenceConfiguration(environment: NodeJS.ProcessEnv) {
  const configuration = {
    apiBaseUrl: environment.GITHUB_API_URL ?? 'https://api.github.com',
    branch: environment.RELEASE_WAVE_STATE_BRANCH ?? '',
    token: environment.GITHUB_TOKEN ?? '',
  };
  if (!configuration.branch || !configuration.token)
    throw new Error('Release-wave mutation fence configuration is incomplete.');
  return configuration;
}

/*** Save a state transition using GitHub's revision precondition. */
async function saveGitHubContentAsync(
  configuration: ReturnType<typeof releaseWaveMutationFenceConfiguration>,
  input: {
    readonly branch: string;
    readonly content: string;
    readonly message: string;
    readonly owner: string;
    readonly path: string;
    readonly repo: string;
    readonly sha?: string;
  },
) {
  const response = await fetch(
    configuration.apiBaseUrl +
      '/repos/' +
      input.owner +
      '/' +
      input.repo +
      '/contents/' +
      input.path,
    {
      body: JSON.stringify({
        branch: input.branch,
        content: input.content,
        message: input.message,
        ...(input.sha === undefined ? {} : { sha: input.sha }),
      }),
      headers: githubHeaders(configuration),
      method: 'PUT',
    },
  );
  if (!response.ok) throw githubError(response.status);
  return { data: (await response.json()) as { readonly content: { readonly sha: string } } };
}

/*** Load the current revisioned fence document from its dedicated state branch. */
async function loadGitHubContentAsync(
  configuration: ReturnType<typeof releaseWaveMutationFenceConfiguration>,
  input: {
    readonly owner: string;
    readonly path: string;
    readonly ref: string;
    readonly repo: string;
  },
) {
  const response = await fetch(
    configuration.apiBaseUrl +
      '/repos/' +
      input.owner +
      '/' +
      input.repo +
      '/contents/' +
      input.path +
      '?ref=' +
      encodeURIComponent(input.ref),
    { headers: githubHeaders(configuration) },
  );
  if (!response.ok) throw githubError(response.status);
  return {
    data: (await response.json()) as {
      readonly content: string;
      readonly encoding: string;
      readonly sha: string;
      readonly type: string;
    },
  };
}

/*** Keep the token at the GitHub composition edge. */
function githubHeaders(
  configuration: ReturnType<typeof releaseWaveMutationFenceConfiguration>,
): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + configuration.token,
    'content-type': 'application/json',
  };
}

/*** Preserve provider status so the CAS adapter can distinguish contention from failure. */
function githubError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error('Release-wave mutation fence GitHub request failed.'), { status });
}
