import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
import { GitHubReleaseWavePublicationCohortAdapter } from './GitHubReleaseWavePublicationCohortAdapter.js';

test('recovers the frozen pre-publish epoch after publisher versions and default-branch revisions advance', async () => {
  const adapter = cohortAdapter();
  const stable = await adapter.collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('base')],
  });
  expect(stable).toBeUndefined();
  const cohort = await adapter.collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('base'), event('left')],
  });
  expect(cohort?.publications.map((publication) => publication.name).sort()).toEqual([
    '@ankhorage/base',
    '@ankhorage/left',
  ]);
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/base'),
  ).toMatchObject({
    packageVersion: '1.1.0',
    sourceRevision: createHash('sha1').update('base').digest('hex'),
  });
  expect(cohort?.repositories.map((repository) => repository.fullName)).toEqual([
    'ankhorage/base',
    'ankhorage/consumer',
    'ankhorage/docs',
    'ankhorage/left',
    'ankhorage/old',
    'ankhorage/pending',
    'ankhorage/private',
  ]);
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/private'),
  ).toMatchObject({ bootstrapReady: false, private: true });
});

test('audits archived, excluded, private, and pending-bootstrap selected repositories distinctly', async () => {
  const cohort = await cohortAdapter().collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('base'), event('left')],
  });

  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/old'),
  ).toMatchObject({ archived: true, publishable: true });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/docs'),
  ).toMatchObject({ excludedReason: 'missing package.json', publishable: false });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/private'),
  ).toMatchObject({ private: true, publishable: false });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/pending'),
  ).toMatchObject({ bootstrapReady: false, publishable: true });
});

test('retains a selected repository without package metadata as an explicit excluded profile', async () => {
  const cohort = await cohortAdapter().collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('base'), event('left')],
  });
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/docs'),
  ).toMatchObject({
    excludedReason: 'missing package.json',
    publishable: false,
  });
});

test('fails closed when a selected dependency section is malformed', () => {
  const adapter = cohortAdapter((url) => {
    if (String(url).includes('/repos/ankhorage/consumer/contents/package.json'))
      return Promise.resolve(
        content({ dependencies: 'not-a-map', name: '@ankhorage/consumer', version: '1.0.0' }),
      );
    return Promise.resolve(response(String(url)));
  });
  expect(
    adapter.collectReleaseWavePublicationCohortAsync({ pendingEvents: [event('base')] }),
  ).rejects.toThrow('malformed dependencies');
});

test('rejects a queued source identity that changes within the selected installation', async () => {
  const forged = { ...event('base'), sourceRepository: 'ankhorage/left' };
  expect(
    await cohortAdapter().collectReleaseWavePublicationCohortAsync({
      pendingEvents: [forged, event('left')],
    }),
  ).toBeUndefined();
});

test('does not admit a frozen epoch after its publisher leaves the current App selection', async () => {
  const adapter = cohortAdapter((url) => {
    if (String(url).includes('/installation/repositories'))
      return Promise.resolve(
        json({
          repositories: ['consumer', 'docs', 'left', 'old', 'pending', 'private'].map((name) => ({
            archived: name === 'old',
            default_branch: 'main',
            full_name: 'ankhorage/' + name,
          })),
        }),
      );
    return Promise.resolve(response(String(url)));
  });
  expect(
    await adapter.collectReleaseWavePublicationCohortAsync({
      pendingEvents: [event('base'), event('left')],
    }),
  ).toBeUndefined();
});

test('keeps an independent complete cohort executable when another frozen epoch is no longer current', async () => {
  const adapter = cohortAdapter(undefined, [publisherEpoch(['base']), publisherEpoch(['left'])]);
  const cohort = await adapter.collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('left')],
  });
  expect(cohort?.epoch.publishers.map((publisher) => publisher.packageName)).toEqual([
    '@ankhorage/left',
  ]);
});

function cohortAdapter(
  requestAsync = (url: string | URL) => Promise.resolve(response(String(url))),
  epochs = [publisherEpoch(['base', 'left'])],
) {
  return GitHubReleaseWavePublicationCohortAdapter({
    apiBaseUrl: 'https://api.github.test',
    publicationEvidencePort: {
      enrichPackageReleaseAsync: (dispatch) =>
        Promise.resolve({
          ...event(dispatch.package_name.slice('@ankhorage/'.length)),
          packageName: dispatch.package_name,
          sourceRepository: dispatch.source_repository,
          version: dispatch.version,
        }),
    },
    publisherEpochPort: {
      loadReleaseWavePublisherEpochsAsync: () => Promise.resolve(epochs),
    },
    requestAsync,
    token: 'installation-token',
  });
}

function publisherEpoch(names: readonly string[]) {
  return {
    id: createHash('sha256').update(names.join('\n')).digest('hex'),
    inventoryId: 'd'.repeat(64),
    sourceRevision: 'c'.repeat(40),
    publishers: names.map((name) => ({
      packageName: '@ankhorage/' + name,
      planRevision: 'a'.repeat(40),
      planStatusHash: 'b'.repeat(64),
      sourceRepository: 'ankhorage/' + name,
      version: '1.1.0',
    })),
  };
}

function event(name: string) {
  const publication = {
    npmArtifactIntegrity: 'sha512-' + Buffer.from(name).toString('base64'),
    packageName: '@ankhorage/' + name,
    releaseId: name + '-1.1.0',
    releaseTag: 'v1.1.0',
    sourceRepository: 'ankhorage/' + name,
    version: '1.1.0',
  };
  return { ...publication, eventId: releaseWaveEventIdentity(publication) };
}

function response(url: string): Response {
  if (url.includes('/installation/repositories'))
    return json({
      repositories: ['base', 'consumer', 'docs', 'left', 'old', 'pending', 'private'].map(
        (name) => ({
          archived: name === 'old',
          default_branch: 'main',
          full_name: 'ankhorage/' + name,
        }),
      ),
    });
  const name = /repos\/ankhorage\/([^/]+)/.exec(url)?.[1];
  if (!name) return new Response(null, { status: 404 });
  if (url.includes('/git/ref/heads/'))
    return json({ object: { sha: createHash('sha1').update(name).digest('hex'), type: 'commit' } });
  if (url.includes('renovate.yml'))
    return ['pending', 'private'].includes(name)
      ? new Response(null, { status: 404 })
      : content("github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'");
  if (name === 'docs' && url.includes('/contents/package.json'))
    return new Response(null, { status: 404 });
  if (url.includes('/contents/package.json')) return content(manifest(name));
  return new Response(null, { status: 404 });
}

function manifest(name: string) {
  const dependencies =
    name === 'consumer' ? { '@ankhorage/base': '^1.0.0', '@ankhorage/left': '^1.0.0' } : {};
  return {
    dependencies,
    name: '@ankhorage/' + name,
    private: name === 'private',
    version: ['base', 'left'].includes(name) ? '1.1.0' : '1.0.0',
  };
}

function content(value: unknown): Response {
  return json({
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
      'base64',
    ),
    encoding: 'base64',
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
