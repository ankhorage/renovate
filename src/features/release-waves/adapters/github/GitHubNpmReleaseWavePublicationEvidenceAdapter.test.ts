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
    { npm: { gitHead: 'other' } },
    { workflows: { workflow_runs: [] } },
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

test('requires the named release workflow and accepts a branch target when the immutable tag is proven', async () => {
  const paths: string[] = [];
  const adapter = GitHubNpmReleaseWavePublicationEvidenceAdapter({
    ...evidenceInput(),
    requestAsync: (url) => {
      const path = String(url);
      paths.push(path);
      return evidenceResponse(path, { release: { target_commitish: 'main' } });
    },
  });
  expect(
    await adapter.enrichPackageReleaseAsync({
      package_name: '@ankhorage/base',
      source_repository: 'ankhorage/base',
      version: '1.1.0',
    }),
  ).toMatchObject({ releaseTag: 'v1.1.0' });
  expect(paths.some((path) => path.includes('/actions/workflows/release.yml/runs?'))).toBe(true);
  expect(paths.some((path) => path.includes('/actions/runs?event=release'))).toBe(false);
});

test('discovers a later named workflow page and rejects an incomplete workflow feed', async () => {
  const laterPage = GitHubNpmReleaseWavePublicationEvidenceAdapter({
    ...evidenceInput(),
    requestAsync: (url) => {
      const path = String(url);
      return evidenceResponse(
        path,
        path.includes('&page=1')
          ? {
              workflows: {
                workflow_runs: Array.from({ length: 100 }, () => ({
                  conclusion: 'failure',
                  head_sha: 'old',
                })),
              },
            }
          : {},
      );
    },
  });
  expect(
    await laterPage.enrichPackageReleaseAsync({
      package_name: '@ankhorage/base',
      source_repository: 'ankhorage/base',
      version: '1.1.0',
    }),
  ).toMatchObject({ releaseId: '42' });

  const incomplete = evidenceAdapter({
    workflows: {
      workflow_runs: Array.from({ length: 100 }, () => ({
        conclusion: 'failure',
        head_sha: 'old',
      })),
    },
  });
  await incomplete
    .enrichPackageReleaseAsync({
      package_name: '@ankhorage/base',
      source_repository: 'ankhorage/base',
      version: '1.1.0',
    })
    .then(
      () => expect.unreachable(),
      (error: unknown) => expect(error).toBeInstanceOf(Error),
    );
});

function evidenceAdapter(
  overrides: {
    readonly npm?: Record<string, unknown>;
    readonly release?: Record<string, unknown>;
    readonly workflows?: Record<string, unknown>;
  } = {},
) {
  return GitHubNpmReleaseWavePublicationEvidenceAdapter({
    ...evidenceInput(),
    requestAsync: (url) => evidenceResponse(String(url), overrides),
  });
}

function evidenceInput() {
  return {
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npmjs.test',
    releaseWorkflowFile: 'release.yml',
    token: 'token',
  };
}

function evidenceResponse(
  path: string,
  overrides: {
    readonly npm?: Record<string, unknown>;
    readonly release?: Record<string, unknown>;
    readonly workflows?: Record<string, unknown>;
  } = {},
) {
  const release = path.includes('/releases/tags/')
    ? { id: 42, tag_name: 'v1.1.0', target_commitish: 'commit', ...overrides.release }
    : path.includes('/git/ref/tags/')
      ? { object: { sha: 'commit', type: 'commit' } }
      : path.includes('/actions/workflows/release.yml/runs')
        ? {
            workflow_runs: [{ conclusion: 'success', head_sha: 'commit' }],
            ...overrides.workflows,
          }
        : {
            dist: { integrity: 'sha512-YmFzZQ==' },
            gitHead: 'commit',
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
}
