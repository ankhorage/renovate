import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/rollout-package-release.yml', import.meta.url),
  'utf8',
);
const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

describe('package release rollout', () => {
  test('keeps the production package-release event contract active', () => {
    expect(workflow).toContain('package_name:');
    expect(workflow).toContain('version:');
    expect(workflow).toContain('source_repository:');
    expect(workflow).toContain('Run Renovate immediately for the released package');
  });

  test('uses only the paginated App installation as positive enrollment', () => {
    expect(workflow).toContain(
      'github.paginate(\n              github.rest.apps.listReposAccessibleToInstallation',
    );
    expect(workflow).toContain("repository.owner?.login === 'ankhorage'");
    expect(workflow).not.toContain('release-consumers.json');
  });

  test('verifies exact published npm identities before starting a rollout', () => {
    expect(workflow).toContain('https://registry.npmjs.org/');
    expect(workflow).toContain('The npm release manifest does not match');
  });
});

describe('release recovery contract', () => {
  test('recovers the current release from its exact version commit', () => {
    expect(releaseWorkflow).toContain('release_sha=""');
    expect(releaseWorkflow).toContain('for candidate_sha in $(git rev-list HEAD)');
    expect(releaseWorkflow).toContain('echo "release_sha=$release_sha" >> "$GITHUB_OUTPUT"');
  });
});
