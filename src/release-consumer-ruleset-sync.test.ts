import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const script = readFileSync(
  new URL('../.github/scripts/sync-release-consumer-rulesets.sh', import.meta.url),
  'utf8',
);

describe('release consumer ruleset sync', () => {
  test('uses the App installation instead of a second positive repository list', () => {
    expect(script).toContain('installation/repositories?per_page=100');
    expect(script).toContain('--paginate');
    expect(script).toContain(
      'GH_TOKEN must be an ankhorage-renovate-sync GitHub App installation token.',
    );
    expect(script).not.toContain('release-consumers.json');
  });

  test('is dry-run by default and requires explicit apply for GitHub mutations', () => {
    expect(script).toContain('MODE="dry-run"');
    expect(script).toContain('== "--apply"');
    expect(script).toContain('Dry-run only. Re-run with --apply to write changes.');
  });

  test('refuses unsafe parent mutation while retaining branch protection safeguards', () => {
    expect(script).toContain('includes_parents=true');
    expect(script).toContain(
      'this repository-scoped sync will not mutate organization-wide policy',
    );
    expect(script).toContain('required_approving_review_count: 1');
    expect(script).toContain('required_review_thread_resolution: true');
  });
});
