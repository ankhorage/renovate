interface SnapshotConfiguration {
  readonly apiBaseUrl: string;
  readonly stateBranch: string;
  readonly token: string;
}

type RequestAsync = (url: string | URL, init?: RequestInit) => Promise<Response>;

/*** Adapt authenticated GitHub Contents calls for the pre-publish acknowledgement state. */
export function githubReleaseWaveSnapshotContentsClient(
  configuration: SnapshotConfiguration,
  requestAsync: RequestAsync,
) {
  return {
    branch: configuration.stateBranch,
    client: {
      repos: {
        createOrUpdateFileContents: (input: ContentWriteInput) =>
          writeContentAsync(configuration, requestAsync, input),
        getContent: (input: ContentReadInput) =>
          readContentAsync(configuration, requestAsync, input),
      },
    },
    owner: 'ankhorage',
    repository: 'renovate',
  };
}

interface ContentWriteInput {
  readonly branch: string;
  readonly content: string;
  readonly message: string;
  readonly owner: string;
  readonly path: string;
  readonly repo: string;
  readonly sha?: string;
}
interface ContentReadInput {
  readonly owner: string;
  readonly path: string;
  readonly ref: string;
  readonly repo: string;
}

/*** Write one state document with the caller's observed revision where GitHub requires it. */
async function writeContentAsync(
  configuration: SnapshotConfiguration,
  requestAsync: RequestAsync,
  input: ContentWriteInput,
) {
  const response = await requestAsync(
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
      headers: headers(configuration),
      method: 'PUT',
    },
  );
  if (!response.ok) throw githubContentsError(response.status);
  return { data: (await response.json()) as { readonly content: { readonly sha: string } } };
}

/*** Read one revisioned state document from the configured durable branch. */
async function readContentAsync(
  configuration: SnapshotConfiguration,
  requestAsync: RequestAsync,
  input: ContentReadInput,
) {
  const response = await requestAsync(
    configuration.apiBaseUrl +
      '/repos/' +
      input.owner +
      '/' +
      input.repo +
      '/contents/' +
      input.path +
      '?ref=' +
      encodeURIComponent(input.ref),
    { headers: headers(configuration) },
  );
  if (!response.ok) throw githubContentsError(response.status);
  return {
    data: (await response.json()) as {
      readonly content: string;
      readonly encoding: string;
      readonly sha: string;
      readonly type: string;
    },
  };
}

/*** Limit headers to the authenticated provider boundary. */
function headers(configuration: SnapshotConfiguration): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + configuration.token,
    'content-type': 'application/json',
  };
}

/*** Preserve provider status for the ACK adapter's CAS conflict classification. */
function githubContentsError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error('Release-wave snapshot GitHub Contents request failed.'), {
    status,
  });
}
