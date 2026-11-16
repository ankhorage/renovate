import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWavePublicationEvidenceAdapter } from './GitHubNpmReleaseWavePublicationEvidenceAdapter.js';

test('enriches the unchanged package-release dispatch only from exact npm and GitHub evidence', async () => {
  const adapter = evidenceAdapter();
  expect(
    await adapter.enrichPackageReleaseAsync({
      package_name: '@ankhorage/base',
      source_repository: 'ankhorage/base',
      version: '1.1.0',
    }),
  ).toEqual({
    npmArtifactIntegrity: 'sha512-YmFzZQ==',
    packageName: '@ankhorage/base',
    releaseId: '42',
    releaseTag: 'v1.1.0',
    sourceRepository: 'ankhorage/base',
    version: '1.1.0',
  });
});

test('fails closed for malformed provenance, missing integrity, and missing or wrong GitHub release evidence', async () => {
  for (const response of [
    { npm: { repository: { url: 'https://github.com/ankhorage/other.git' } }, release: {} },
    { npm: { dist: {} }, release: {} },
    { npm: {}, release: { ok: false } },
    { npm: {}, release: { tag_name: 'v1.2.0' } },
  ]) {
    const failure = await evidenceAdapter(response)
      .enrichPackageReleaseAsync({
        package_name: '@ankhorage/base',
        source_repository: 'ankhorage/base',
        version: '1.1.0',
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(Error);
  }
});

function evidenceAdapter(
  overrides: {
    readonly npm?: Record<string, unknown>;
    readonly release?: Record<string, unknown>;
  } = {},
) {
  return GitHubNpmReleaseWavePublicationEvidenceAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npmjs.test',
    requestAsync: (url) => {
      const release = String(url).includes('/releases/tags/')
        ? { id: 42, tag_name: 'v1.1.0', ...overrides.release }
        : {
            dist: { integrity: 'sha512-YmFzZQ==' },
            name: '@ankhorage/base',
            repository: { url: 'https://github.com/ankhorage/base.git' },
            version: '1.1.0',
            ...overrides.npm,
          };
      return Promise.resolve(
        new Response(JSON.stringify(release), {
          status: overrides.release?.ok === false ? 404 : 200,
        }),
      );
    },
    token: 'token',
  });
}
