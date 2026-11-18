import { expect, test } from 'bun:test';

import { GitHubNpmReleaseWaveExecutionAdapter } from './GitHubNpmReleaseWaveExecutionAdapter.js';
import { githubReleaseWaveResponseFor } from './githubReleaseWaveResponse.testSupport.js';

test('requires the candidate manifest and lockfile to adopt every planned version', async () => {
  expect(await verificationFor(lockfileFor('@ankhorage/provider', '2.0.0'))).toMatchObject({
    lockfileUpdated: true,
  });
});

test('rejects an unrelated lockfile occurrence of a planned dependency version', async () => {
  expect(await verificationFor('{"note":"@ankhorage/provider@2.0.0"}')).toMatchObject({
    lockfileUpdated: false,
  });
});

/** Verify direct manifest and canonical Bun-lock resolution evidence at the candidate revision. */
async function verificationFor(lockfile: string) {
  const adapter = GitHubNpmReleaseWaveExecutionAdapter({
    apiBaseUrl: 'https://api.github.test',
    npmRegistryUrl: 'https://registry.npm.test',
    owner: 'ankhorage',
    releaseWorkflowFile: 'release.yml',
    renovateAsync: () => Promise.resolve(),
    requestAsync: (url) => Promise.resolve(responseFor(String(url), lockfile)),
    token: 'test-token',
  });
  return adapter.verifyReleaseWaveRepositoryAsync({
    candidatePublication: candidatePublication(),
    node: {
      dependencies: [],
      expectedDependencies: [{ packageName: '@ankhorage/provider', version: '2.0.0' }],
      expectedPublication: { version: '1.2.4' },
      packageName: '@ankhorage/example',
      repository: 'ankhorage/example',
      requiresNpmPublication: true,
    },
    runId: 'wave',
  });
}

/** Override only the candidate's direct dependency evidence while retaining full provider fixtures. */
function responseFor(url: string, lockfile: string): Response {
  if (url.includes('/contents/package.json?ref=base-sha'))
    return content({ dependencies: { '@ankhorage/provider': '^1.0.0' } });
  if (url.includes('/contents/package.json?ref=candidate-sha'))
    return content({ dependencies: { '@ankhorage/provider': '^2.0.0' } });
  if (url.includes('/contents/bun.lock?ref=candidate-sha')) return content(lockfile);
  return githubReleaseWaveResponseFor(url);
}

/** Bind a complete patch Changesets result to the fixture candidate head. */
function candidatePublication() {
  return {
    packageName: '@ankhorage/example',
    releases: [{ packageName: '@ankhorage/example', type: 'patch' as const }],
    revision: 'candidate-sha',
    statusHash: 'a'.repeat(64),
    version: '1.2.4',
  };
}

/** Encode fixture contents through GitHub's documented base64 envelope. */
function content(value: unknown): Response {
  return new Response(
    JSON.stringify({
      content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
        'base64',
      ),
      encoding: 'base64',
    }),
    { status: 200 },
  );
}

/** Model Bun's root direct declaration and exact package locator. */
function lockfileFor(packageName: string, version: string): string {
  return JSON.stringify({
    packages: { [packageName]: [packageName + '@' + version] },
    workspaces: { '': { dependencies: { [packageName]: '^' + version } } },
  });
}
