import type { ChangesetReleasePlan, ReleaseWaveRepository } from '../../../types/releaseWave.js';

/** Create a complete selected repository whose revision binds a Changesets publication decision. */
export function publisherRepository(
  packageName: string,
  version = '1.0.0',
  sourceRevision = 'a'.repeat(40),
): ReleaseWaveRepository {
  return {
    archived: false,
    bootstrapReady: true,
    dependencies: {
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    fullName: 'ankhorage/' + packageName.slice('@ankhorage/'.length),
    packageName,
    packageVersion: version,
    private: false,
    publishable: true,
    sourceRevision,
  };
}

/** Create the only eligible single-package patch Changesets decision for a selected repository. */
export function publisherPlan(
  repository: ReleaseWaveRepository,
  version = '1.1.0',
): ChangesetReleasePlan {
  if (repository.packageName === undefined || repository.sourceRevision === undefined)
    throw new Error('Provider-contract publisher fixture requires an immutable package source.');
  return {
    packageName: repository.packageName,
    releases: [{ packageName: repository.packageName, type: 'patch' }],
    revision: repository.sourceRevision,
    version,
  };
}

/** Emulate authenticated GitHub Contents reads and CAS writes without calling a live provider. */
export function githubContentsFixture(
  input: {
    readonly conflicts?: number;
    readonly document?: unknown;
    readonly revision?: string;
  } = {},
) {
  let conflicts = input.conflicts ?? 0;
  let document: unknown = input.document;
  let revision = input.document === undefined ? undefined : (input.revision ?? 'a'.repeat(40));
  let writes = 0;
  const requests: { readonly init: RequestInit | undefined; readonly url: string }[] = [];
  return {
    authorizations: () =>
      requests.map(({ init }) => new Headers(init?.headers).get('authorization')),
    document: () => document,
    requestAsync: (url: string | URL, init?: RequestInit) => {
      requests.push({ init, url: String(url) });
      if (init?.method !== 'PUT') return Promise.resolve(readResponse(document, revision));
      writes += 1;
      if (conflicts > 0) {
        conflicts -= 1;
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      const update = updateBody(init.body);
      if (update.sha !== revision) return Promise.resolve(new Response(null, { status: 409 }));
      document = JSON.parse(Buffer.from(update.content, 'base64').toString('utf8'));
      revision = String(writes).padStart(40, '0');
      return Promise.resolve(json({ content: { sha: revision } }));
    },
    requests,
    revision: () => revision,
  };
}

/** Encode a GitHub Contents response exactly as the provider adapter consumes it. */
function readResponse(document: unknown, revision: string | undefined): Response {
  if (document === undefined) return new Response(null, { status: 404 });
  return json({
    content: Buffer.from(JSON.stringify(document)).toString('base64'),
    encoding: 'base64',
    sha: revision,
  });
}

/** Decode a narrow Contents update request and reject malformed fixture callers. */
function updateBody(body: RequestInit['body']): {
  readonly content: string;
  readonly sha?: string;
} {
  if (typeof body !== 'string') throw new Error('Expected JSON GitHub Contents update body.');
  const value = JSON.parse(body) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected GitHub Contents CAS request.');
  const update = value as Readonly<Record<string, unknown>>;
  if (
    typeof update.content !== 'string' ||
    (update.sha !== undefined && typeof update.sha !== 'string')
  )
    throw new Error('Expected GitHub Contents CAS request.');
  return { content: update.content, sha: update.sha };
}

/** Return a deterministic JSON provider response. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value));
}
