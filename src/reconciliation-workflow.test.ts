import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/reconcile.yml', import.meta.url),
  'utf8',
);

describe('Renovate reconciliation workflow', () => {
  test('uses the paginated selected App installation as its only positive inventory', () => {
    expect(workflow).toContain(
      'github.paginate(github.rest.apps.listReposAccessibleToInstallation',
    );
    expect(workflow).toContain("repository.owner?.login === 'ankhorage'");
    expect(workflow).not.toContain('release-consumers.json');
    expect(workflow).toContain('release-wave-exclusions.json');
  });

  test('rejects unselected targeted repositories and reports bootstrap/exclusion state', () => {
    expect(workflow).toContain('not selected in the Renovate Sync App installation');
    expect(workflow).toContain('pending-bootstrap');
    expect(workflow).toContain(': archived');
    expect(workflow).toContain(': excluded: ');
  });

  test('runs only App-selected, bootstrapped repositories with bounded concurrency', () => {
    expect(workflow).toContain('max-parallel: 4');
    expect(workflow).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(workflow).toContain("RENOVATE_AUTODISCOVER: 'false'");
    expect(workflow).toContain("RENOVATE_ONBOARDING: 'false'");
  });

  test('does not independently advance Ankhorage packages during scheduled reconciliation', () => {
    expect(workflow).toContain('RENOVATE_PACKAGE_RULES');
    expect(workflow).toContain('"@ankhorage/**"');
  });
});
