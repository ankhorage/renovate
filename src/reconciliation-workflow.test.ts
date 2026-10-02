import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const workflow = readFileSync(
  new URL('../.github/workflows/reconcile.yml', import.meta.url),
  'utf8',
);

describe('Renovate reconciliation workflow', () => {
  test('runs a full managed-repository sweep on policy changes and every day', () => {
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '17 3 * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('- default.json');
    expect(workflow).toContain('- release-consumers.json');
    expect(workflow).toContain("fs.readFileSync('release-consumers.json', 'utf8')");
    expect(workflow).toContain('repository: ${{ fromJSON(needs.prepare.outputs.repositories) }}');
  });

  test('uses the canonical repository config without release-only package overrides', () => {
    expect(workflow).toContain("RENOVATE_AUTODISCOVER: 'false'");
    expect(workflow).toContain("RENOVATE_ONBOARDING: 'false'");
    expect(workflow).toContain('RENOVATE_REPOSITORIES: ${{ matrix.repository }}');
    expect(workflow).toContain('RENOVATE_REQUIRE_CONFIG: required');
    expect(workflow).toContain('RENOVATE_TOKEN: ${{ steps.app-token.outputs.token }}');
    expect(workflow).not.toContain('RENOVATE_PACKAGE_RULES');
    expect(workflow).not.toContain('RENOVATE_PR_HOURLY_LIMIT');
  });

  test('keeps the reconciliation runner itself reproducible and bounded', () => {
    expect(workflow).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(workflow).toContain('max-parallel: 4');
    expect(workflow).toContain('group: renovate-reconciliation');
    expect(workflow).toContain('cancel-in-progress: false');
  });
});
