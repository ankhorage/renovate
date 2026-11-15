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

describe('package release-wave coordinator', () => {
  test('uses only the paginated App installation as positive enrollment', () => {
    expect(workflow).toContain(
      'github.paginate(github.rest.apps.listReposAccessibleToInstallation',
    );
    expect(workflow).toContain("repository.owner?.login === 'ankhorage'");
    expect(workflow).not.toContain('release-consumers.json');
    expect(workflow).toContain('release-wave-exclusions.json');
  });

  test('collects default-branch manifests and verifies stable published npm identities', () => {
    expect(workflow).toContain("const manifestText = await readFile(repository, 'package.json')");
    expect(workflow).toContain('https://registry.npmjs.org/');
    expect(workflow).toContain("metadata?.['dist-tags']?.latest");
    expect(workflow).toContain("latest.includes('-')");
  });

  test('writes a deterministic resumable checkpoint and keeps execution explicitly disabled', () => {
    expect(workflow).toContain('bun src/cli/commands/release/plan.ts');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).toContain("vars.ANKHORAGE_RELEASE_WAVES_ENABLED == 'true'");
    expect(workflow).toContain('intentionally gated until independent review approves activation');
  });
});

describe('release recovery contract', () => {
  test('recovers the current release from its exact version commit', () => {
    expect(releaseWorkflow).toContain('release_sha=""');
    expect(releaseWorkflow).toContain('for candidate_sha in $(git rev-list HEAD)');
    expect(releaseWorkflow).toContain('echo "release_sha=$release_sha" >> "$GITHUB_OUTPUT"');
  });
});
