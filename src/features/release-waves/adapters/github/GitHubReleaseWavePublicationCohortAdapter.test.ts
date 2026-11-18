import { expect, test } from 'bun:test';

import { releaseWaveEventIdentity } from '../../domain/releaseWaveEventIdentity.js';
import { GitHubReleaseWavePublicationCohortAdapter } from './GitHubReleaseWavePublicationCohortAdapter.js';

test('waits for every selected upstream publisher required by a selected consumer diamond', async () => {
  const adapter = cohortAdapter();
  expect(
    await adapter.collectReleaseWavePublicationCohortAsync({ pendingEvents: [event('base')] }),
  ).toBeUndefined();
  const cohort = await adapter.collectReleaseWavePublicationCohortAsync({
    pendingEvents: [event('base'), event('left')],
  });
  expect(cohort?.publications.map((publication) => publication.name).sort()).toEqual([
    '@ankhorage/base',
    '@ankhorage/left',
  ]);
  expect(cohort?.repositories.map((repository) => repository.fullName)).toEqual([
    'ankhorage/base',
    'ankhorage/consumer',
    'ankhorage/left',
    'ankhorage/private',
  ]);
  expect(
    cohort?.repositories.find((repository) => repository.fullName === 'ankhorage/private'),
  ).toMatchObject({ bootstrapReady: false, private: true });
});

test('rejects a queued source identity that changes within the selected installation', async () => {
  const forged = { ...event('base'), sourceRepository: 'ankhorage/left' };
  expect(
    await cohortAdapter().collectReleaseWavePublicationCohortAsync({
      pendingEvents: [forged, event('left')],
    }),
  ).toBeUndefined();
});

function cohortAdapter() {
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
    requestAsync: (url) => Promise.resolve(response(String(url))),
    token: 'installation-token',
  });
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
      repositories: ['base', 'consumer', 'left', 'private'].map((name) => ({
        archived: false,
        default_branch: 'main',
        full_name: 'ankhorage/' + name,
      })),
    });
  const name = /repos\/ankhorage\/([^/]+)/.exec(url)?.[1];
  if (!name) return new Response(null, { status: 404 });
  if (url.includes('/git/ref/heads/'))
    return json({ object: { sha: name + '-sha', type: 'commit' } });
  if (url.includes('renovate.yml'))
    return name === 'private'
      ? new Response(null, { status: 404 })
      : content("github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'");
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
    version: '1.0.0',
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
