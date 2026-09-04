import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const registry = JSON.parse(
  readFileSync(new URL('../devtools-consumers.json', import.meta.url), 'utf8'),
) as { readonly repositories: readonly string[] };
const workflow = readFileSync(
  new URL('../.github/workflows/rollout-devtools-release.yml', import.meta.url),
  'utf8',
);

describe('Devtools release rollout registry', () => {
  test('lists each current managed Devtools consumer exactly once', () => {
    expect(registry.repositories).toHaveLength(31);
    expect(new Set(registry.repositories).size).toBe(registry.repositories.length);
    expect(registry.repositories).toContain('ankhorage/renovate');
    expect(registry.repositories).not.toContain('ankhorage/devtools');
    expect(registry.repositories).not.toContain('ankhorage/api-gateway');
    for (const repository of registry.repositories) {
      expect(repository).toMatch(/^ankhorage\/[a-z0-9-]+$/);
    }
  });
});

describe('Devtools release rollout workflow', () => {
  test('accepts explicit release events and validates their exact version', () => {
    expect(workflow).toContain('repository_dispatch:');
    expect(workflow).toContain('devtools-release');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('Devtools rollout requires one exact published semver version.');
    expect(workflow).toContain('/^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/');
  });

  test('targets only the reviewed registry through the organization Renovate Sync App', () => {
    expect(workflow).toContain("fs.readFileSync('devtools-consumers.json', 'utf8')");
    expect(workflow).toContain('The Devtools consumer registry must not contain duplicates.');
    expect(workflow).toContain("github.actor == 'ankhorage-renovate-sync[bot]'");
    expect(workflow).toContain('awaiting the one-time workflow bootstrap');
    expect(workflow).toContain('has-repositories: ${{ steps.registry.outputs.has-repositories }}');
    expect(workflow).toContain("if: needs.validate.outputs.has-repositories == 'true'");
    expect(workflow).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(workflow).toContain('RENOVATE_REQUIRE_CONFIG: required');
    expect(workflow).toContain('RENOVATE_PACKAGE_RULES:');
    expect(workflow).toContain('"allowedVersions":"${{ needs.validate.outputs.version }}"');
    expect(workflow).toContain(
      'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
    );
    expect(workflow).toContain('ANKHORAGE_RENOVATE_SYNC_CLIENT_ID');
    expect(workflow).toContain('ANKHORAGE_RENOVATE_SYNC_PRIVATE_KEY');
    expect(workflow).toContain('permission-issues: write');
    expect(workflow).toContain('permission-pull-requests: write');
  });

  test('serializes duplicate deliveries while leaving every consumer update to Renovate', () => {
    expect(workflow).toContain('group: devtools-release-rollout');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('bun x renovate');
    expect(workflow).not.toContain('git push');
    expect(workflow).not.toContain('pulls.create');
  });
});
