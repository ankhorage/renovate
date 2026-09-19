import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const registry = JSON.parse(
  readFileSync(new URL('../release-consumers.json', import.meta.url), 'utf8'),
) as { readonly repositories: readonly string[] };
const workflow = readFileSync(
  new URL('../.github/workflows/rollout-package-release.yml', import.meta.url),
  'utf8',
);

describe('package release rollout registry', () => {
  test('lists every reviewed managed package consumer exactly once', () => {
    expect(registry.repositories).toHaveLength(37);
    expect(new Set(registry.repositories).size).toBe(registry.repositories.length);
    expect(registry.repositories).toContain('ankhorage/apm');
    expect(registry.repositories).toContain('ankhorage/devtools');
    expect(registry.repositories).toContain('ankhorage/local');
    expect(registry.repositories).toContain('ankhorage/minikube');
    expect(registry.repositories).toContain('ankhorage/studio');
    expect(registry.repositories).toContain('ankhorage/renovate');
    expect(registry.repositories).not.toContain('ankhorage/api-gateway');
    expect(registry.repositories).not.toContain('ankhorage/gh');
    expect(registry.repositories).not.toContain('ankhorage/zora-navigation');
    for (const repository of registry.repositories) {
      expect(repository).toMatch(/^ankhorage\/[a-z0-9-]+$/);
    }
  });
});

describe('package release rollout validation', () => {
  test('accepts one exact Ankhorage package release identity', () => {
    expect(workflow).toContain('repository_dispatch:');
    expect(workflow).toContain('package-release');
    expect(workflow).not.toContain('devtools-release');
    expect(workflow).toContain('package_name:');
    expect(workflow).toContain('source_repository:');
    expect(workflow).toContain('Package rollout requires one valid @ankhorage package name.');
    expect(workflow).toContain('Package rollout requires one exact published semver version.');
    expect(workflow).toContain('Package rollout requires one valid Ankhorage source repository.');
    expect(workflow).toContain('/^@ankhorage\\/[a-z0-9][a-z0-9-]*$/');
    expect(workflow).toContain('/^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/');
  });

  test('verifies the exact npm artifact before scheduling consumers', () => {
    expect(workflow).toContain('https://registry.npmjs.org/');
    expect(workflow).toContain('encodeURIComponent(packageName)');
    expect(workflow).toContain('encodeURIComponent(version)');
    expect(workflow).toContain('releaseManifest?.name !== packageName');
    expect(workflow).toContain('releaseManifest?.version !== version');
    expect(workflow).toContain(
      'The npm release manifest does not match the dispatched package identity.',
    );
  });

  test('targets only reviewed App-visible consumers and excludes the source repository', () => {
    expect(workflow).toContain("fs.readFileSync('release-consumers.json', 'utf8')");
    expect(workflow).toContain('github.rest.apps.listReposAccessibleToInstallation');
    expect(workflow).toContain(
      'The ankhorage-renovate-sync GitHub App installation does not include registered package consumers',
    );
    expect(workflow).toContain('(repository) => repository !== sourceRepository');
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'ankhorage-renovate-sync[bot]'",
    );
    expect(workflow).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(workflow).toContain('RENOVATE_REQUIRE_CONFIG: required');
  });
});

describe('package release rollout execution', () => {
  test('keeps the immutable workflow protocol gate specific to Devtools releases', () => {
    expect(workflow).toContain("if (packageName === '@ankhorage/devtools')");
    expect(workflow).toContain('let requiredProtocol = 0;');
    expect(workflow).toContain('if (requiredProtocol === 0)');
    expect(workflow).toContain("core.setOutput('compatible', 'true')");
    expect(workflow).toContain(
      'The canonical Renovate sync protocol cannot satisfy this Devtools release.',
    );
    expect(workflow).toContain('Update the immutable Renovate workflow first');
    expect(workflow).toContain("Wait for this repository's compatible immutable Renovate workflow");
  });

  test('runs only the exact released Ankhorage package through Renovate', () => {
    const rules = readReleasePackageRules('@ankhorage/apm', '0.8.9');

    expect(rules).toEqual([
      { matchPackageNames: ['@ankhorage/**'], enabled: false },
      {
        matchDatasources: ['npm'],
        matchPackageNames: ['@ankhorage/apm'],
        enabled: true,
        rangeStrategy: 'bump',
        allowedVersions: '0.8.9',
        recreateWhen: 'always',
      },
    ]);
    expect(workflow).toContain("RENOVATE_PR_HOURLY_LIMIT: '0'");
    expect(workflow).toContain('bun x renovate');
    expect(workflow).not.toContain('git push');
    expect(workflow).not.toContain('pulls.create');
  });

  test('serializes releases per package without cancelling an in-flight rollout', () => {
    expect(workflow).toContain(
      'group: package-release-rollout-${{ github.event.client_payload.package_name || inputs.package_name }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain("node-version: '24'");
  });
});

type ReleasePackageRule = Readonly<Record<string, unknown>>;

/*** Parse the final exact-package rollout rules from the managed workflow fixture. */
function readReleasePackageRules(
  packageName: string,
  version: string,
): readonly ReleasePackageRule[] {
  const stepMarker = '- name: Run Renovate immediately for the released package';
  const stepStart = workflow.indexOf(stepMarker);
  if (stepStart < 0) {
    throw new Error('Package rollout workflow does not declare the final package update step.');
  }
  const marker = 'RENOVATE_PACKAGE_RULES: >-\n            ';
  const start = workflow.indexOf(marker, stepStart);
  if (start < 0) {
    throw new Error('Package rollout workflow does not declare RENOVATE_PACKAGE_RULES.');
  }
  const rendered = workflow
    .slice(start + marker.length)
    .split('\n', 1)[0]
    ?.replace('${{ needs.validate.outputs.package_name }}', packageName)
    .replace('${{ needs.validate.outputs.version }}', version);
  if (!rendered) throw new Error('Package rollout package rules are empty.');
  const parsed: unknown = JSON.parse(rendered);
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error('Package rollout must render exactly two release-specific package rules.');
  }
  return parsed as readonly ReleasePackageRule[];
}
